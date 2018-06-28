#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" "$0" "$@"
"use strict";

/*yarn-to-obj
 * Takes a file (.txt maybe) and turns it into an .obj file. Input file should
 * be a series of 3D coordinates with each component delineated by a space and
 * each new coordinate separated by a new line. The .obj should connect those
 * points into a long winding line representing a yarn path.
 */


//parse command line
if (process.argv.length != 4) {
    console.error("Usage:\nyarn-to-obj.js <in.txt> <out.obj>");
    process.exitCode = 1;
    return;
}
let inputFile = process.argv[2];
let objFile = process.argv[3];
const fs = require('fs');
//------------------------------------
function numberize(strings){
    for(let i = 0; i<strings.length; i++){
        strings[i] = parseFloat(strings[i].trim());
    }
    return strings;
}

function main(){
    //creating objFile
    let buffer = '';
    let carriers = [];
    let carrierChange = [];
    let carrierChangeTarget = [];

    let points = fs.readFileSync(inputFile, 'utf8').trim().split('\n');
    let yarnPoints = 0;

    //sets up different colors for carriers
    for(let i = 1; i<=16; i++){
        buffer+= 'newmtl mtl'+i+'\n';
        buffer+= 'Kd '+Math.random()+' '+Math.random()+' '+Math.random()+'\n';
    }

    //adds each coordinate
    for(let i = 0; i<points.length; i++){
        if(points[i][0] == parseInt(points[i][0])){
            buffer+= 'v '+points[i]+'\n';
            yarnPoints++;
        }else if('c' === points[i][0]){
            let sliced = points[i].slice(2);
            carriers.push(sliced);
        }else if('u' === points[i][0]){
            carrierChange[yarnPoints] = points[i];
        }
    }
    //adds each coordinate but slightly offset
    let offset = 0.01;
    for(let i = points.length-1; i>=0; i--){
        if(points[i][0] == parseInt(points[i][0])){
            let comp = numberize(points[i].split(' '));
            let x = comp[0]+offset;
            let y = comp[1]+offset;
            let z = comp[2]+offset;
            buffer+= 'v '+x+' '+y+' '+z+' '+'\n';
        }
    }

    //add carrier coordinates
    for(let i = 0; i<carriers.length; i++){
        buffer+= 'v '+carriers[i]+'\n';
    }

    //connect the dots
    for(let i = 1; i<yarnPoints; i++){
        if(carrierChange[i-1])
            buffer+=carrierChange[i-1] +'\n';
        buffer+= 'f '+i+' '+(i+1)+' '
            +(2*yarnPoints-i)+' '+(2*yarnPoints-i+1)+'\n';
    }
    //draw triangles
    for(let i = 0; i<carriers.length; i+=3){
        let index = i+2*yarnPoints+1;
        buffer+='f '+index+' '+(index+1)+' '+(index+2)+'\n';
    }
    fs.writeFileSync(objFile, buffer);
}

main();
