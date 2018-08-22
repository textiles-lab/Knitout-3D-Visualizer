#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" "$0" "$@"
"use strict";

/*yarn-to-obj
 * Takes a .txt file and turns it into an .obj file. Input file should
 * be a series of 3D coordinates with each component delineated by a space and
 * each new coordinate separated by a new line. The .obj should connect those
 * points into chunky poly lines representing yarn paths. Different carriers are
 * represented by different (random) colors.
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

//points from the input file are strings, so must be converted to number
//coordinates
function numberize(strings){
    for(let i = 0; i<strings.length; i++){
        strings[i] = parseFloat(strings[i].trim());
    }
    return strings;
}

function main(){
    //creating objFile
    let buffer = '';
    let carrierChange = []; //stores the command to change color

    let points = fs.readFileSync(inputFile, 'utf8').trim().split('\n');
    let yarnPoints = 0; //total number of coordinates

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
        }else if('u' === points[i][0]){
            //this is when the txt file includes the phrase "usemtl"
            //marks a different yarn/carrier
            carrierChange[yarnPoints] = points[i];
        }
    }
    //adds each coordinate but slightly offset
    //this is done because the online obj viewer I used to test doesn't support
    //lines, so I had to make all the poly lines into faces.
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

    //creates the faces to make up the polylines
    for(let i = 1; i<yarnPoints; i++){
        if(carrierChange[i-1]){
            //different carrier so change color, and separate line
            buffer+=carrierChange[i-1] +'\n';
        }else if(!carrierChange[i]){
            buffer+= 'f '+i+' '+(i+1)+' '
                +(2*yarnPoints-i)+' '+(2*yarnPoints-i+1)+'\n';
        }
    }

    //copies all the stuff into the output file
    fs.writeFileSync(objFile, buffer);
}

main();
