import { GbxClient } from '@evotm/gbxclient';
import { MongoClient,ServerApiVersion  } from 'mongodb';

const dotenv = require('dotenv').config();
const uri = process.env.DB_URI;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });



async function main() {
    let gbx = new GbxClient();
    await gbx.connect("127.0.0.1", 5000);
    await gbx.call("SetApiVersion", "2013-04-16");
    await gbx.call("EnableCallbacks", true);       

    try {
        await gbx.call("Authenticate", "SuperAdmin", "SuperAdmin");
    } catch (e) {
        console.log("Authenticate to server failed.");
        process.exit(0);
    }
    //get initial info
    console.log("Loading initials informations");
    let response = await gbx.multicall([
        ['GetSystemInfo'],
        ['GetMapList', -1, 0],
		['GetPlayerList',100,0],
		['GetCurrentMapInfo'],
		['GetNextMapInfo'],
    ]);

    saveInitialsInformations(response[0],response[1],response[2],response[3],response[4]);
    console.log("Done");
    let serverId = response[2][0]['NickName'];


    //callbacks to update information
	gbx.on("ManiaPlanet.BeginMap", async (response) => {
        let nextMap = await gbx.call("GetNextMapInfo", response[0]);
        console.log("Map started : "+response[0]['UId']);
        //update currentMap and nextMap
        client.connect(async err => {
            const collection = client.db("Brawl").collection("servers");
            await collection.updateOne(
                { _id :serverId},
                { $set: { currentMap :response[0]['UId']}}
            );
            await collection.updateOne(
                { _id :serverId},
                { $set: { nextMap :nextMap['UId']}}
            );
            client.close();
        })
    });
	gbx.on("ManiaPlanet.PlayerConnect", async (response) => {
        console.log("Player connected :  " + response[0]);
        let playerInfo = await gbx.call("GetPlayerInfo", response[0]);
        //add player to the players list
        client.connect(async err => {
            const collection = client.db("Brawl").collection("servers");
            await collection.updateOne(
                { _id :serverId},
                { $push: { players:{login:response[0],name:playerInfo['NickName']}}}
            );
            client.close();
        })
    });
	gbx.on("ManiaPlanet.PlayerDisconnect", async (response) => {
        console.log("Player disconnected :  " + response[0]);
        //remove player from the players list
        client.connect(async err => {
            const collection = client.db("Brawl").collection("servers");
            await collection.updateOne(
                {_id :serverId },
                { $pull: { players:{ login:response[0]}}}
            );
            client.close();
        })
    });
    gbx.on("ManiaPlanet.MapListModified", async (response) => {
        console.log("Map list modified");
        //if a map has been added or removed we update the maplist in the database
        if(response[2]===true){
            let mapList = await gbx.call('GetMapList', -1, 0);
            client.connect(async err => {
                const collection = client.db("Brawl").collection("servers");
                await collection.updateOne(
                    { _id :serverId},
                    { $set: { maps :mapList}}
                );
                client.close();
            })
        }
    });
    console.log("Listening to server...");
}
async function saveInitialsInformations(systemInfo,mapList,entitiesList,currentMap,nextMap){
    let maps=[];
    let players=[]

    //separate the server from the players
    let server = entitiesList[0];
    let users = entitiesList.slice(1);

    mapList.forEach(map => {
        maps.push(map['UId']);
    });

    users.forEach(user=>{
        players.push({login:user['Login'],name:user['NickName']});
    });
    
    //update or create the server document
    client.connect(async err => {
        const collection = client.db("Brawl").collection("servers");
        const query = { _id: server['NickName'] };
        const update = { $set: {_id: server['NickName'], map:maps,players:players,currentMap:currentMap['UId'],nextMap:nextMap['UId'] }};
        const options = { upsert: true };     
        await collection.updateOne(query, update, options);
        client.close();
    })
}

main();