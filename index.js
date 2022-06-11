const express = require('express')
const bodyParse = require('body-parser')
const config = require('./config.json')
const hostFile = require('./data.json')
const fs = require('fs')
const {exec} = require('child_process')
const {XMLParser} = require('fast-xml-parser')

const openvas_user = "admin";
const openvas_password = "admin";
const container_name = "openvas";

const XML = new XMLParser({ignoreAttributes: false});

const app = express()
app.use(bodyParse.json());

const port = config.port;
app.post('/api/hosts', (req, res) => {
    try{
        if(req.body.length > 0){
            saveData(req.body);
            checkHostTargets();
        }
        res.sendStatus(204);
    }catch (error){
        console.log(error);
        res.sendStatus(500);
    }
})

app.listen(port, () => {
    console.log(`Openvas auto-API listening on port ${port}`);
    console.log(`http://yourIP:${port}/api/hosts`)
})

function saveData(hosts){
    let toSaveHosts = [];
    for(let host of hostFile.hosts){
        toSaveHosts.push(host);
    }
    for(let host of hosts){
        let hostExists = toSaveHosts.some(x => x.host === host.host);
        //Replace timestamp
        if(hostExists){
            toSaveHosts.forEach((_host,index)=>{
                if(_host.host === host.host){
                    toSaveHosts[index].time = host.time;
                }
            })
        }else{
            toSaveHosts.push(host);
        }
    }
    hostFile.hosts = toSaveHosts;
    fs.writeFileSync('./data.json',JSON.stringify(hostFile), {encoding:'utf8'})
}

function checkHostTargets(){
    let toReplace =[];
    for(let host of hostFile.hosts){
        //Target does not exist
        if(!host.hasOwnProperty("targetID")){
            //Create target
            let response = createTarget(host.host);
            if(response != null) toReplace.push(response);
        } else {
            toReplace.push(host);
        }
    }
    hostFile.hosts = toReplace;
    fs.writeFileSync('./data.json',JSON.stringify(hostFile), {encoding:'utf8'})
}

function createTarget(host){
    let generatedTargetName = generateTargetName();
    let xml_cmd = `<create_target>\<name>${generatedTargetName}</name><hosts>${host}</hosts></create_target>`
    let openvas_cmd = `omp -u ${openvas_user} -w ${openvas_password} -iX`;
    let command = `sudo docker exec ${container_name} ${openvas_cmd} "${xml_cmd}"`
    console.log(command)
    exec(command, (error, stdout, stderr) => {
       if(!error){
            try{
                let parsed_xml = XML.parse(stdout);
                if(parsed_xml['@_status'] == 201){

                }
            }catch (e){
                console.log(e);
                return null;
            }
       }
       console.log(error);
       return null;
    });
}

function generateTargetName(){
    let result           = 'GENERATED_TARGET_';
    const characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < 15; i++){
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}