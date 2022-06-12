const express = require('express')
const bodyParse = require('body-parser')
const config = require('./config.json')
const hostFile = require('./data.json')
const fs = require('fs')
const {exec} = require('child_process')
const {XMLParser, XMLBuilder} = require('fast-xml-parser')
const node_schedule = require('node-schedule');

const openvas_user = "admin";
const openvas_password = "admin";
const container_name = "openvas";

const XML = new XMLParser({ignoreAttributes: false});
const builder = new XMLBuilder({ignoreAttributes: false});

const app = express()
app.use(bodyParse.json());

const port = config.port;
app.post('/api/hosts', (req, res) => {
    try{
        if(req.body.length > 0){
            saveData(req.body);
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
        let hostExists = toSaveHosts.some(x => x.host === host);
        //Replace timestamp
        if(hostExists){
            toSaveHosts.forEach((_host,index)=>{
                if(_host.host === host){
                    toSaveHosts[index].time = Date.now();
                }
            })
        }else{
            toSaveHosts.push({host: host, time: Date.now()});
        }
    }
    hostFile.hosts = toSaveHosts;
    fs.writeFileSync('./data.json',JSON.stringify(hostFile), {encoding:'utf8'})
}


async function createTarget(newTargetName){
    let createTargetObj = {
        create_target: {
            name: newTargetName,
            hosts: hostFile.hosts.filter(x => x.time > Date.now() - config.scan_host_active_in_the_last_hours * 60 * 60 * 1000).map(x => x.host).join(", ")
        }
    }
    let createTargetXML = builder.build(createTargetObj);
    let openvas_cmd = `omp -u ${openvas_user} -w ${openvas_password} -iX`;
    let command = `sudo docker exec ${container_name} ${openvas_cmd} '${createTargetXML}'`
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if(!error){
                try{
                    let parsed_xml = XML.parse(stdout);
                    if(parsed_xml['create_target_response']['@_status'] === '201' && parsed_xml['create_target_response']['@_id']){
                        console.log(`${new Date().toLocaleString()} : Target ${newTargetName} created. ID:${parsed_xml['create_target_response']['@_id']}`);
                        resolve(parsed_xml['create_target_response']['@_id']);
                    }
                }catch (e){
                    console.log(e);
                    resolve(null);
                }
            } else {
                console.log(error);
                resolve(null);
            }
        });
    });
}

async function createTask(targetID, taskName, config_id, scanner_id){
    let createTaskObj = {
        create_task: {
            name: taskName,
            target: {'@_id': targetID},
            config: {'@_id': config_id},
            scanner: {'@_id': scanner_id}
        }
    }
    let createTaskXML = builder.build(createTaskObj);
    let openvas_cmd = `omp -u ${openvas_user} -w ${openvas_password} -iX`;
    let command = `sudo docker exec ${container_name} ${openvas_cmd} '${createTaskXML}'`
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if(!error){
                try{
                    let parsed_xml = XML.parse(stdout);
                    if(parsed_xml['create_task_response']['@_status'] === '201' && parsed_xml['create_task_response']['@_id']){
                        console.log(`${new Date().toLocaleString()} : Task ${taskName} created. ID:${parsed_xml['create_task_response']['@_id']}`);
                        resolve(parsed_xml['create_task_response']['@_id']);
                    }
                }catch (e){
                    console.log(e);
                    resolve(null);
                }
            } else {
                console.log(error);
                resolve(null);
            }
        });
    });
}

async function startTask(taskID){
    let startTaskObj = {
        start_task: {
            '@_task_id': taskID
        }
    }
    let startTaskXML = builder.build(startTaskObj);
    let openvas_cmd = `omp -u ${openvas_user} -w ${openvas_password} -iX`;
    let command = `sudo docker exec ${container_name} ${openvas_cmd} '${startTaskXML}'`
    return new Promise((resolve, reject) => {
        console.log(`${new Date().toLocaleString()} : Task ${taskID} started.`);
        exec(command, (error, stdout, stderr) => {
            if(!error){
                try{
                    let parsed_xml = XML.parse(stdout);
                    if(parsed_xml['start_task_response']['@_status'] === '202' && parsed_xml['start_task_response']['@_id']){
                        console.log(`${new Date().toLocaleString()} : Task ${taskID} finished.`);
                        resolve(true);
                    }
                }catch (e){
                    console.log(e);
                    resolve(null);
                }
            } else {
                console.log(error);
                resolve(null);
            }
        });
    });
}

async function scheduler(){
    let schedules = [];
    for(let scanSchedule of config.scan_times){
        let scan_config = config.scan_configs.filter(x => x.name === scanSchedule.type);
        if(scan_config.length === 1){
            schedules.push({
                name: scanSchedule.type,
                config_id: scan_config[0].config_id,
                scanner_id: scan_config[0].scanner_id,
                hour: scanSchedule.time.split(':')[0],
                minute: scanSchedule.time.split(':')[1]
            });
        }else {
            console.log(`${new Date().toLocaleString()} : Scan config ${scanSchedule.type} not found.`);
        }
    }
    for(let schedule of schedules){
        node_schedule.scheduleJob(`${schedule.minute} ${schedule.hour} * * *`, async function () {
            console.log(`${new Date().toLocaleString()} : Scan schedule ${schedule.name} started.`);
            let targetID = await createTarget(`${schedule.name}_${schedule.hour}:${schedule.minute}_${new Date().getFullYear()}/${new Date().getMonth()+1}/${new Date().getDate()}_LAST_${config.scan_host_active_in_the_last_hours}_HOURS`);
            if (targetID == null) {
                console.log(`${new Date().toLocaleString()} : Scan schedule ${schedule.name} failed to create target.`);
                return;
            }
            let taskID = await createTask(targetID, `${schedule.name}_${schedule.hour}:${schedule.minute}_${new Date().getFullYear()}/${new Date().getMonth()+1}/${new Date().getDate()}`, schedule.config_id, schedule.scanner_id);
            if (taskID == null) {
                console.log(`${new Date().toLocaleString()} : Scan schedule ${schedule.name} failed to create task.`);
                return;
            }
            let startTaskState = await startTask(taskID);
            if (startTaskState == null) {
                console.log(`${new Date().toLocaleString()} : Scan schedule ${schedule.name} failed to start task.`);
            }
        });
    }
}

scheduler();

