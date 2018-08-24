#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" "$0" "$@"
"use strict";

/*knitout-3D-visualizer.js
 * Takes a knitout file and turns it into an .txt file. The result should
 * be a series of 3D coordinates with each component delineated by a space and
 * each new coordinate separated by a new line.
 * Carriers will be marked in the resultant file by a "c" preceding the coordinates
 * of that carrier.
 */

//parse command line
if (process.argv.length != 4) {
    console.error("Usage:\nknitout-3D-visualizer.js <in.k> <out.txt>");
    process.exitCode = 1;
    return;
}

//TODO ah currently height checking doesnt check the carriers crossed at carrier
//depth whoops

//globals

//file setup
var knitoutFile = process.argv[2];
var textFile = process.argv[3];
const fs = require('fs');
var stream = fs.createWriteStream(textFile);

//data store stuff
var frontActiveRow = []; //info on the active stitch(es) on each needle on the front bed
var backActiveRow = []; //info on the active stitch(es) on each needle on the back bed
var lastNeedle = []; //array of the last used needle for each carrier
var anyLast; //the last needle used. Can be of any carrier.
var maxHeight = [];
//array of the max "height" for each needle's associated stitch and carrier position
var allCarriers = []; //all carriers declared by the header of the .k file
var maxCarriers = 0; //changed during parsing. equal to the length of allCarriers

//parameters (These can *probably* be changed without wrecking everything)
var boxWidth = 1;
var boxHeight = 1;
var boxDepth = 0.1;
var boxSpacing = boxHeight/2;
var epsilon = 0.1; //amount stitches are moved "up" to avoid intersecting

//layer depths
const FRONT_BED = 1;
const BACK_BED = -1;
const CARRIERS = -0.4;
const FRONT_SLIDERS = 0.5;
const BACK_SLIDERS = -0.5;
const CROSSING = boxWidth/3;
const PADDING = boxWidth/10;
let CARRIER_SPACING = (FRONT_SLIDERS-CARRIERS); //to be dividied by number of total carriers

//different pass types:
const TYPE_KNIT_TUCK = 'knit-tuck';
const TYPE_A_MISS = 'a-miss';
const TYPE_SPLIT = 'split';
const TYPE_SPLIT_VIA_SLIDERS = 'split-via-sliders';
const TYPE_XFER = 'xfer';
const TYPE_XFER_TO_SLIDERS = 'xfer-to-sliders';
const TYPE_XFER_FROM_SLIDERS = 'xfer-from-sliders';

//different pass yarn hook actions:
const HOOK_IN = 'hook-in'; //bring in yarn using hook before pass starts (GRIPPER_IN must also be set)
const HOOK_RELEASE = 'hook-release'; //release yarn from hook after pass ends
const HOOK_OUT = 'hook-out'; //bring yarn out using hook after pass ends (GRIPPER_OUT must also be set)

//different pass yarn gripper actions:
const GRIPPER_IN = 'gripper-in'; //bring yarn in from gripper (inhook will also set HOOK_IN)
const GRIPPER_OUT = 'gripper-out'; //bring yarn out to gripper (outhook will also set HOOK_OUT)

//pass directions:
const DIRECTION_LEFT = '-';
const DIRECTION_RIGHT = '+';
const DIRECTION_NONE = '';

//special op, turns into a MISS if slot is unoccupied, or merges with knit/tuck/etc.
const OP_SOFT_MISS = {color:16};
const OP_MISS_FRONT = {color:216 /*bed:'f'*/}; //116 == front miss (with links process), 216 == front miss (independent carrier movement)
const OP_MISS_BACK  = {color:217 /*bed:'b'*/}; //117 == back miss (with links process), 217 == back miss (independent carrier movement)
//NOTE: this code sometimes uses 216/217 without independent carrier movement, at that seems to be okay(?!?)
const OP_TUCK_FRONT = {color:11, isFront:true };
const OP_TUCK_BACK	= {color:12, isBack:true };
const OP_KNIT_FRONT = {color:51, isFront:true};
const OP_KNIT_BACK	= {color:52, isBack:true};
//combo ops:
const OP_XFER_TO_BACK = {color:20};
const OP_XFER_TO_FRONT = {color:30};
const OP_SPLIT_TO_BACK = {color:101};
const OP_SPLIT_TO_FRONT = {color:102};
//helper functions

//return a combined operation that does 'a' then 'b' (moving right) or null
//if such a thing doesn't exist
function merge_ops(a,b,quarterPitch){
    if(a===OP_SOFT_MISS)
        return b;
    else if(b===OP_SOFT_MISS)
        return a;
    return null;
}

//BedNeedle helps store needles:

function BedNeedle(bed, needle) {
    if (arguments.length == 1 && typeof(arguments[0]) === "string") {
        let str = arguments[0];
        let m = str.match(/^([fb]s?)(-?\d+)$/);
        if (!m) {
            throw "ERROR: invalid needle specification '" + str + "'.";
        }
        this.bed = m[1];
        this.needle = parseInt(m[2]);
    } else if (arguments.length == 2 && typeof(arguments[0]) === "string"
        && typeof(arguments[1]) === "number") {
        this.bed = arguments[0];
        this.needle = arguments[1];
    } else {
        throw "Don't know how to construct a BedNeedle from the given arguments";
    }
}

BedNeedle.prototype.toString = function() {
    return this.bed + this.needle;
};

BedNeedle.prototype.isFront = function(){
    if (this.bed === 'f' || this.bed === 'fs') return true;
    else if (this.bed === 'b' || this.bed === 'bs') return false;
    else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isBack = function(){
    if (this.bed === 'f' || this.bed === 'fs') return false;
    else if (this.bed === 'b' || this.bed === 'bs') return true;
    else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isHook = function(){
    if (this.bed === 'f' || this.bed === 'b') return true;
    else if (this.bed === 'fs' || this.bed === 'bs') return false;
    else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isSlider = function(){
    if (this.bed === 'fs' || this.bed === 'bs') return true;
    else if (this.bed === 'f' || this.bed === 'b') return false;
    else throw "Invalid bed in BedNeedle.";
};

//Carrier objects store information about each carrier:
function Carrier(name) {
    this.name = name;
    this.last = null; //last stitch -- {needle:, direction:} -- or null if not yet brought in
    this.in = null; //the "in" operation that added this to the active set. (format: {op:"in", cs:["", "", ...]})
}

//yarn is a 2D array that stores points for the entire knitted yarn thing
//yarn is organized by the number value assigned to each carrier.
//withing each yarn[carrier number] is a another array where the indexes represent
//"rows".
//
//the idea of "rows" in this code is primarily for organization purposes. A new
//row is formed when:
//  a) the direction of knitting changes
//  b) a knit is made somewhere that already has a stitch
let yarn = [];

//each yarn[carrier number][row number] holds a "yarnPass" object.
//the field "bloops" is an array of loop objects on the back bed
//the field "floops" is an array of loop objects on the front bed.
//  (each loop is stored in the array index = to its needle number)
//the field direction is the direction that the loops were all knit in ('+' or '-')
function yarnPass(floops, bloops, direction){
    this.bloops = bloops;
    this.floops = floops;
    this.direction = direction;
}

//used in frontActiveRow and backActiveRow.
//Its just an object that stores the "row" and carrier of the currently active
//loop on a certain needle.
function loopSpec(row, carrier){
    this.row = row;
    this.carrier = carrier;
}

//stored in the array that is accessed by yarn[carrier #][row #].floops
//or yarn[carrier #][row #].bloops
function loop(pts, carrier){
    this.ctrlPts = pts; //array of coordinates for the stitch
    this.carrier = carrier; //carrier the stitch was knit with
}

//just a helper to put points in the proper format for the output file
function format(x, y, z){
    return x+" "+y+" "+z+"\n";
}

//converts a carrier string to a set number
function getCarrierNum(cs){
    for(let i = 0; i<maxCarriers;i++){
        if(allCarriers[i] == cs)
            return i;
    }
    console.assert(false, "Tried to access a non-active carrier.");
}

//This function is used to obtain a index for acessing "horizons"
//(the max height of part of the yarn)
//horizons shall be stored only for 2 points of each needle now:
//the main stitch area, and the carrier area associated with that needle

//planes should be 'f' or 'b' or 'c'
//needle should be a number
//direction should be '+' or '-' if 'c' for plane
//  direction does NOT refer to the direction of knitting, but the side of
//  the stitch the desired carrier position is on. '-' means left and '+' right
//carrier should be some string
function pointName(plane, direction, needle, carrier){
    console.assert(plane==='f'||plane==='b'||plane==='c',
        "'plane' field must be 'f', 'b', or 'c'.");
    console.assert(typeof(needle) == 'number', "'needle' must be a number.");
    if(plane === 'c')
        console.assert(direction==='+'||direction==='-',
            "'direction' field can only be '-' or '+'");
    console.assert(typeof(carrier) == 'string',
        "'carrier' field must be a string.");

    let index = 0;
    let c = maxCarriers;
    //each needle occupies c+2 indices.
    //front and back versions of each needle
    //and then c indices, one for each carrier at the carrier depth.

    let n = needle;
    if(plane==='c' && direction==='-')
        n -=1 ;
    index+=n*(c+2);
    if(plane==='b')
        index+1;
    else if(plane==='c')
        index+=+2;

    index+=getCarrierNum(carrier);

    return index;
}

//gets the necessary height to prevent intersections at the carrier level
function getMaxHeight(minHeight, startNeedle, endNeedle, carrier){
    let raised = false;
    let max = minHeight;
    for(let i = startNeedle; i<endNeedle; i++){
        let index = pointName('c', '+', i, carrier);
        if(maxHeight[index]>=max){
            raised = true;
            max = maxHeight[index];
        }
    }
    if(raised) max +=epsilon;

    return max;
}

//updates max height for a range
function setMaxHeight(newHeight, startNeedle, endNeedle, carrier){
    for(let i = startNeedle; i<endNeedle; i++){
        let index = pointName('c', '+', i, carrier);
        maxHeight[index] = newHeight;
    }
}

//gets yarn "height" of neighboring loops
function neighborHeight(bed, needle, carrier){
    let max = 0;
    let cNum = getCarrierNum(carrier);
    let left = needle-1;
    let right = needle+1;
    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);

    if(yarn[cNum] === undefined)
        return max;
    while(left>=0||right<activeRow.length){
        if(left>=0){
            if(activeRow[left]!==undefined){
                let row = activeRow[left].row;
                if(yarn[cNum][row]!==undefined){
                    if((bed==='f' && yarn[cNum][row].floops[left])
                        ||(bed==='b' && yarn[cNum][row].bloops[left])){
                        max = Math.max(max, minHeight(activeRow[left], bed, left));
                        left = -1;
                    }
                }
            }
            left--;
        }
        if(right<activeRow.length){
            if(activeRow[right]!==undefined){
                let row = activeRow[right].row;
                if(yarn[cNum][row]!==undefined){
                    if((bed==='f'&& yarn[cNum][row].floops[right])
                        ||(bed==='b'&&yarn[cNum][row].bloops[right])){
                        max = Math.max(max, minHeight(activeRow[right], bed, right));
                        right = activeRow.length;
                    }
                }
            }
            right++;
        }
    }
    return max;
}

//this gets the minimum height needed for starting a stitch at a certain needle
//this is obtained by subtracting from the top of the stitch because in some
//edge cases, the head of the stitch is raised to avoide intersections, and this
//way ensures that obtaining the height for knitting the next stitch is correct
function minHeight(needleSpec, bed, needle){
    let max = -Infinity;
    let carrier = needleSpec.carrier;
    let cNum = getCarrierNum(carrier);
    let loops = (bed==='f' ? yarn[cNum][needleSpec.row].floops[needle]
        : yarn[cNum][needleSpec.row].bloops[needle]);
    for(let i = 0; i<loops.length; i++){
        max = Math.max(max, loops[i].ctrlPts[6][1]);
    }
    return max - (boxHeight/6) - boxSpacing;
}

//Note that when going from back bed to the appropriate carrier depth, the yarn
//passes over any carrier slots < the desired.
//When going from front bed to the appropriate carrier depth, the yarn passes
//carrier slots > the number of the desired carrier.
function carrierCheck(height, bed, needle, cNum){
    let raised = false;
    let min = height;
    if(bed === 'f'){
        for(let i = cNum+1; i<maxCarriers; i++){
            let index = pointName('c', '+', needle, allCarriers[i]);
            if(maxHeight[index]>=min){
                raised = true;
                min = maxHeight[index];
            }
        }
    }else{
        for(let i = 0; i<cNum; i++){
            let index = pointName('c', '+', needle, allCarriers[i]);
            if(maxHeight[index]>=min){
                raised = true;
                min = maxHeight[index];
            }
        }
    }
    if(raised) min+=epsilon;
    return min;
}

//updates last stitch to avoid intersections at the carrier level
function updateLast(lastNeedle, direction, bed, needle, carrier, height){
    let cNum = getCarrierNum(carrier);
    let padding = (direction==='-' ? -PADDING : PADDING);
    //padding is the little space between the start of the "box" for each
    //stitch and the position that it goes back to the carrier at. It's different
    //depending on what carrier is knitting the stitch
    let carrierDepth = CARRIERS+CARRIER_SPACING*cNum;

    //end is the starting point of the current stitch, so the last stitch,
    //which is being updated in this function should end there
    let end = [needle*(boxWidth+boxSpacing), height, carrierDepth];
    if(direction === '+') end[0] -= boxWidth;

    let carrierHeight = height;
    if(lastNeedle[cNum]!==undefined){
        //get the stitch that needs to be updated
        let toUpdate = (lastNeedle[cNum].bed==='f'?
            yarn[cNum][lastNeedle[cNum].row].floops[lastNeedle[cNum].needle]
            : yarn[cNum][lastNeedle[cNum].row].bloops[lastNeedle[cNum].needle]);
        toUpdate = toUpdate[toUpdate.length-1].ctrlPts;
        let lastPt = toUpdate.length-1;

        //determine which sides of the current and previous needle are part of the
        //region that needs to be checked
        let n1 = needle;
        let n2 = lastNeedle[cNum].needle;
        let LorR1 = (n1>n2 ? '-' : '+');
        if(lastNeedle[cNum].direction !== direction)
            LorR1 = (LorR1==='-' ? '+' : '-');
        let LorR2 = (n2<n1 ? '+' : '-');

        let upperBound = Math.max(n1, n2);
        let lowerBound = Math.min(n1, n2);
        carrierHeight = toUpdate[lastPt][1];
        carrierHeight = getMaxHeight(carrierHeight, lowerBound,
            upperBound, carrier);

        //checking for intersection with yarn from other carriers
        carrierHeight = carrierCheck(carrierHeight, bed, n1, cNum);
        carrierHeight = carrierCheck(carrierHeight, lastNeedle[cNum].bed, n2, cNum);

        //update last stitch
        let subPadPrev = padding/maxCarriers * cNum;

        toUpdate[lastPt][0] = end[0]+subPadPrev;

        toUpdate[lastPt][1] = carrierHeight;

        toUpdate[lastPt-1][1] = carrierHeight;

        toUpdate[lastPt-2][1] = carrierHeight;

        //set maxheight in between needles
        setMaxHeight(carrierHeight, lowerBound, upperBound, carrier);
    }
    return carrierHeight;
}

//makes a list of points for a standard stitch
function makeStitch(direction, bed, needle, carrier, height){
    let cNum = getCarrierNum(carrier);
    let info = [];
    let width = boxWidth-PADDING*2;
    let dx = width/5;
    let dy =  boxHeight/3;
    let dz = boxDepth/2;
    let padding = (direction==='-' ? -PADDING : PADDING);
    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);

    let carrierDepth = CARRIERS+CARRIER_SPACING*cNum;
    let start = [needle*(boxWidth+boxSpacing), height, carrierDepth];

    if(direction === '-') dx*= -1;
    else start[0] -= boxWidth;

    if(bed==='b'){
        dz*=-1;
    }

    //updates last stitch to prevent intersections
    //carrierHeight is the starting height for this stitch as well.
    let carrierHeight = updateLast(lastNeedle, direction, bed, needle, carrier, height);

    //find the current needed height for the end of the current stitch
    let x = start[0];
    let y = start[1];
    let z = start[2];

    //again, this represents the carrier specific location that a stitch goes
    //between the bed to carrier depth
    let subPad = padding/maxCarriers * getCarrierNum(carrier);
    let bedx1 = x+padding; //this is the start of the stitch after the padding
    let bedx2 = x + padding + 5*dx +padding - subPad;
    //this is the bed to carrier location at the end of the stitch
    let nextStart = x +
        (direction==='-' ? (-boxSpacing-boxWidth) : (boxSpacing+boxWidth));
    //this is the start of the next stitch aka the end of the current "box"

    x += subPad;
    z = (bed==='b' ? BACK_BED : FRONT_BED);
    info.push([x, carrierHeight, z]);
    info.push([x, y, z]);

    x = bedx1;
    info.push([x, y, z]);

    x += 2*dx;
    z -= dz;
    info.push([x, y, z]);

    y += dy;
    z += 2*dz;
    info.push([x, y, z]);

    x -= dx;
    info.push([x, y, z]);

    y += dy;
    info.push([x, y, z]);

    x += dx;
    z -= 2*dz;
    info.push([x, y, z]);

    x += dx;
    info.push([x, y, z]);

    x += dx;
    z += 2*dz;
    info.push([x, y, z]);

    y -= dy;
    info.push([x, y, z]);

    x -= dx;
    info.push([x, y, z]);

    y -= dy;
    z -= 2*dz;
    info.push([x, y, z]);

    x += 2*dx;
    z += dz;
    info.push([x, y, z]);

    x = bedx2;
    info.push([x, y, z]);
    info.push([x, y, z]);

    y = height;
    z = carrierDepth;
    info.push([x, y, z]);

    x = nextStart;
    info.push([x, y, z]);

    return info;
}


//makes a tuck. TODO multiple tucks on same needle
function tuck(direction, bed, needle, carrier){
    let cNum = getCarrierNum(carrier);
    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);

    let row = (lastNeedle[cNum]===undefined ? 0 : lastNeedle[cNum].row);
    if(lastNeedle[cNum]!==undefined && lastNeedle[cNum].direction!==direction)
        row++;
    let height = (activeRow[needle] !== undefined ?
        minHeight(activeRow[needle], bed, needle)
        : neighborHeight(bed, needle, carrier));

    let info = makeStitch(direction, bed, needle, carrier, height);
    let newLoop = new loop(info, carrier);
    if(yarn[cNum]!==undefined && yarn[cNum][row]!==undefined){
        let yarnLoops = (bed==='f' ?
                        yarn[cNum][row].floops : yarn[cNum][row].bloops);
        if(yarnLoops[needle]){
            yarnLoops[needle].push(newLoop);
        }else{
            yarnLoops[needle] = [newLoop];
        }
    }else{
        let newFloop = [];
        let newBloop = [];
        if(bed==='f'){
            newFloop[needle] = [newLoop];
        }else
            newBloop[needle] = [newLoop];
        if(yarn[cNum]===undefined)
            yarn[cNum] = [];
        yarn[cNum][row] = new yarnPass(newFloop, newBloop, direction);
    }

    if(!activeRow[needle]){
        activeRow[needle] = new loopSpec(row, carrier);
    }else{
        activeRow[needle].row = [row];
        activeRow[needle].carrier = carrier;
    }
    lastNeedle[cNum] = {}
    lastNeedle[cNum].needle = needle;
    lastNeedle[cNum].carrier = carrier;
    lastNeedle[cNum].bed = bed;
    lastNeedle[cNum].direction = direction;
    lastNeedle[cNum].row = row;
    anyLast = lastNeedle[cNum];
}

//makes a knit
function knit(direction, bed, needle, carrier){
    let cNum = getCarrierNum(carrier);
    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);
    let topHeight = neighborHeight(bed, needle, carrier);
    let bottomHeight = (activeRow[needle] !== undefined ?
        minHeight(activeRow[needle], bed, needle)+boxSpacing
        : topHeight);

    let info = makeStitch(direction, bed, needle, carrier, bottomHeight);
    if(topHeight>bottomHeight){
        //if the height of neighbor yarns is taller than the current stitch,
        //it causes an intersection at the place where the stitch goes up in order
        //to go back to the carrier depth.
        //
        //this attempts to fix it by raising the stretching the top loop of a
        //stitch up. It seems to work for simple cases. TODO Needs more testing.
        let topInfo = makeStitch(direction, bed, needle, carrier, topHeight);
        for(let i = 4; i<=11; i++){
            info[i] = topInfo[i];
        }
    }

    let row = (lastNeedle[cNum]===undefined ? anyLast.row : lastNeedle[cNum].row);
    let lastDir = (lastNeedle[cNum]===undefined?
        anyLast.direction : lastNeedle[cNum].direction);
    if(direction!==lastDir)
        row++;
    let newLoop = new loop(info, carrier);

    if(yarn[cNum]!==undefined && yarn[cNum][row]!==undefined){
        let yarnLoops = (bed==='f' ?
            yarn[cNum][row].floops : yarn[cNum][row].bloops);
        yarnLoops[needle] = [newLoop];
    }else{
        let newFloop = [];
        let newBloop = [];
        if(bed==='f'){
            newFloop[needle] = [newLoop];
        }else
            newBloop[needle] = [newLoop];
        if(yarn[cNum]===undefined)
            yarn[cNum] = [];
        yarn[cNum][row] = new yarnPass(newFloop, newBloop, direction);
    }
    activeRow[needle] = new loopSpec(row, carrier);
    lastNeedle[cNum] = {};
    lastNeedle[cNum].carrier = carrier;
    lastNeedle[cNum].needle = needle;
    lastNeedle[cNum].bed = bed;
    lastNeedle[cNum].direction = direction;
    lastNeedle[cNum].row = row;
    anyLast = lastNeedle[cNum];
}

//transfer one loop to a different place
//TODO xfer should keep the places the needle has been to to ensure proper
//representation of yarn crossing and stuff.
//When doing: make sure to check for intersections and also update code that
//assumes each yarn loop has a set number of points (just in knit() and
//makeStitch() I think).
function xfer(fromSide, fromNeedle, toSide, toNeedle){
    let fromActiveRow = (fromSide==='f' ? frontActiveRow : backActiveRow);
    let toActiveRow = (toSide==='f' ? frontActiveRow : backActiveRow);
    if(!fromActiveRow[fromNeedle]){
        console.warn("Hmmm why are you trying to transfer from a needle without yarn? Ignored the instruction for now");
        return;
    }

    let specs = fromActiveRow[fromNeedle];
    let cNum = getCarrierNum(specs.carrier);
    let info = (fromSide==='f' ? yarn[cNum][specs.row].floops[fromNeedle]
        : yarn[cNum][specs.row].bloops[fromNeedle]);

    let dx = (info[0].ctrlPts[2][0]-info[0].ctrlPts[1][0])/2;
    let direction = (dx<0 ? '-' : '+');
    let height = (toActiveRow[toNeedle] ?
        minHeight(toActiveRow[toNeedle], toSide, toNeedle)
        : minHeight(fromActiveRow[fromNeedle], fromSide, fromNeedle));
    let updatedInfo = makeStitch(direction, toSide, toNeedle,
        info[0].carrier, height);

    for(let i = 5; i<=10; i++){
        for(let j = 0; j<info.length; j++){
            let x = updatedInfo[i][0];
            let y = updatedInfo[i][1]-epsilon;
            let z = updatedInfo[i][2];
            info[j].ctrlPts[i] = [x, y, z];
        }
    }
    let row = specs.row;
    if(toActiveRow[toNeedle]===undefined){
        toActiveRow[toNeedle] = new loopSpec(row, specs.carrier);
    }

    let destRow = yarn[cNum][row];
    if(yarn[cNum][toRow] === undefined){
        let newFloop = [];
        let newBloop = [];
        yarn[cNum][row] = new yarnPass(newFloop, newBloop,
                            yarn[cNum][row].direction);
        destRow = yarn[cNum][row];
    }

    let destination = (toSide==='f' ? destRow.floops[toNeedle]
        : destRow.bloops[toNeedle]);

    for(let i = 0; i<info.length; i++){
        let newLoop = new loop(info[i].ctrlPts.slice(), info[i].carrier);
        if(destination){
            if(toSide==='f')
                destRow.floops[toNeedle].push(newLoop);
            else
                destRow.bloops[toNeedle].push(newLoop);
        }else{
            if(toSide==='f')
                destRow.floops[toNeedle] = [newLoop];
            else
                destRow.bloops[toNeedle] = [newLoop];
        }
    }
    if(lastNeedle[cNum].needle === fromNeedle
        && lastNeedle[cNum].bed === fromSide){
        lastNeedle[cNum].needle = toNeedle;
        lastNeedle[cNum].bed = toSide;
    }

    info = undefined;
    fromActiveRow[fromNeedle] = undefined;
    if(fromSide==='f') yarn[cNum][fromRow].floops[fromNeedle] = undefined;
    else yarn[cNum][fromRow].bloops[fromNeedle] = undefined;
}

//transfer all the points stored in "yarn" into the output file
//ft. a incredibly gross number of nested things and braces
function makeTxt(){
    let mostRecentC;
    for(let cNum = 0; cNum<maxCarriers;cNum++){
        if(yarn[cNum]!==undefined){
            stream.write("usemtl mtl"+cNum+"\n");
            for(let row = 0; row<yarn[cNum].length; row++){
                if(yarn[cNum][row]!==undefined){
                    let direction = yarn[cNum][row].direction;
                    let yarnRow = yarn[cNum][row];
                    let maxNeedle = Math.max(yarnRow.floops.length,
                                    yarnRow.bloops.length);
                    for(let col = 0; col<maxNeedle; col++){
                        let needle = col;
                        if(direction === '-') needle = maxNeedle-col-1;
                        let loop = yarnRow.floops[needle];
                        if(loop){
                            for(let i = 0; i<loop.length; i++){
                                let pts = loop[i].ctrlPts;
                                for(let j = 0; j<pts.length; j++){
                                    let pt = pts[j];
                                    stream.write(format(pt[0], pt[1], pt[2]));
                                }
                            }
                        }
                        loop = yarnRow.bloops[needle];
                        if(loop){
                            for(let i = 0; i<loop.length; i++){
                                let pts = loop[i].ctrlPts;
                                for(let j = 0; j<pts.length; j++){
                                    let pt = pts[j];
                                    stream.write(format(pt[0], pt[1], pt[2]));
                                }
                            }
                        }

                    }
                }
            }
        }
    }
}

//main parser
//heavily based on the knitout-dat.js parsing code in knitout-backend
function main(){
    function slotNumber(bn){
        if(bn.isFront())
            return bn.needle;
        else
            return bn.needle+Math.floor(racking);
    }

    function slotString(bn){
        return slotNumber(bn).toString();
    }

    function handleIn(cs, info){
        if(cs.length === 0) return;
        let inInfo = null;
        cs.forEach(function(c){
            if(!(c in carriers))
                throw "ERROR: using a carrier ("+c+") that isn't active.";
            if(carriers[c].in){
                inInfo = carriers[c].in;
                carriers[c].in = null;
            }
        });
        if(inInfo){
            if(JSON.stringify(inInfo.cs) !== JSON.stringify(cs))
                throw "first use of carriers "+JSON.stringify(cs)
                    +" doesn't match in info " +JSON.stringify(inInfo);
            if(inInfo.op === 'in'){
                info.gripper = GRIPPER_IN;
            }else if(inInfo.op === 'inhook'){
                info.gripper = GRIPPER_IN;
                info.hook = HOOK_IN;
                if(hook !== null)
                    throw "ERROR: can't bring in "+JSON.stringify(cs)
                        +" with hook; hook is holding "+JSON.stringify(hook.cs);
                hook = {direction: info.direction, cs:cs.slice()};
            }else{
                console.assert(false, "inInfo.op must be 'in' or 'inhook'.");
            }
        }
    }

    //update the .last member of the given carriers
    function setLast(cs, d, n){
        console.assert(typeof(n)==='object', "setLast needs a needle.");
        cs.forEach(function(c){
            console.assert(c in carriers, "carrier not in carrier set");
            carriers[c].last =
                {needle:n, direction:d};
        });
    }


    let lines = fs.readFileSync(knitoutFile, 'utf8').split("\n");
    (function checkVersion(){
        let m = lines[0].match(/^;!knitout-(\d+)$/);
        if(!m)
            throw "File does not start with knitout magic string";
        if(parseInt(m[1])>2)
            console.warn("WARNING: File is version "+m[1]
                +", but this code only knows about versions up to 2.");
    })();

    function getCarriers(line){
        let m = line.includes(";;Carriers:");
        if(m){
            let c = line.substring(12);
            allCarriers = c.split(' ');
            maxCarriers = allCarriers.length;
            CARRIER_SPACING /= maxCarriers;
        }
    }

    let carriers = {}; //each are a name=>object map
    let hook = null;
    let racking = 0.0; //starts centered
    let stitch = 5; //machine-specific stitch number

    let row = 0;

    lines.forEach(function(line, lineIdx){
        row++;
        let i = line.indexOf(';');
        if(i>=0){
            getCarriers(line);
            line = line.substr(0,i);
        }
        let tokens = line.split(/[ ]+/);

        if(tokens.length>0 && tokens[0] ==="") tokens.shift();
        if(tokens.length>0 && tokens[tokens.length-1] === "") tokens.pop();

        if(tokens.length == 0) return;

        let op = tokens.shift();
        let args = tokens;

        //handle synonyms
        if(op === 'amiss'){
            op = 'tuck';
            args.unshift('+');
        }else if(op === 'drop'){
            op = 'knit';
            args.unshift('+');
        }else if(op === 'xfer'){
            op = 'split';
            args.unshift('+');
        }


        if(op === 'in' || op === 'inhook'){
            let cs = args;
            if(cs.length === 0)
                throw "ERROR: Can't bring in no carriers.";

            cs.forEach(function(c){
                if (c in carriers)
                    throw "Can't bring in an already active carrier, "+c;
            });

            let inInfo = {op:op, cs:cs.slice()};

            //mark all carriers as pending
            cs.forEach(function(c){
                let carrier = new Carrier(c);
                carrier.in = inInfo;
                carriers[c] = carrier;
            });
        }else if(op === 'releasehook'){
            let cs = args;
            if(hook === null){
                throw "ERROR: Can't releasehook on "+cs+", it's empty.";
            }else if(JSON.stringify(hook.cs) !== JSON.stringify(cs)){
                throw "ERROR: Can't releasehook on "+cs+
                    ", hook currently holds "+hook+".";
            }
            hook = null;
        }else if (op === 'out' || op === 'outhook'){
            let cs = args;
            cs.forEach(function(c){
                if(!(c in carriers))
                    throw "ERROR: Can't bring out inactive carrier '"+c+".";
                if(!carriers[c].last){
                    throw "ERROR: Can't bring out carrier '"+c
                        +"---it asn't yet stitched.";
                }
            });

            if(op === 'outhook' && hook !==null)
                throw "ERROR: Can't outhook carriers "+cs+", hook is holding "
                    +hook+".";
            let s = -Infinity;
            let n = null;
            cs.forEach(function(c){
                let t = slotNumber(carriers[c].last.needle);
                if(t>s){
                    s = t;
                    n = carriers[c].last.needle;
                }
            });

            //remove carriers from active set:
            cs.forEach(function(c){
                delete carriers[c];
            });

        }else if(op === 'tuck'|| op === 'knit'){
            let d = args.shift();
            let n = new BedNeedle(args.shift());
            let cs = args;

            if(cs.length === 0){
                if(op === 'miss')
                    throw "ERROR: it makes no sense to miss with no yarns.";
                else
                    d = DIRECTION_NONE; //miss and drop are directionless
            }

            let type;
            if(op === 'miss' && cs.length === 0){
                type = TYPE_A_MISS;
            }else{
                type = TYPE_KNIT_TUCK;
            }

            let info = {
                type:type,
                slots:{},
                racking:racking,
                stitch:stitch,
                carriers:cs,
                direction:d
            }

            if(op === 'miss') info.slots[slotString(n)] =
                (n.isFront() ? OP_MISS_FRONT : OP_MISS_BACK);
            else if(op === 'tuck'){
                if(n.isFront()){
                    tuck(d, 'f', n.needle, cs[0]);
                }else{
                    tuck(d, 'b', n.needle, cs[0]);
                }
            }else if(op === 'knit'){
                if(n.isFront()){
                    knit(d, 'f', n.needle, cs[0]);
                }else{
                    knit(d, 'b', n.needle, cs[0]);
                }
            }else console.assert(false, "op was miss, tuck, or knit");

            handleIn(cs, info);
            setLast(cs, d, n);
        } else if(op === 'rack'){
            if(args.length !== 1) throw "ERROR: racking takes one argument";
            if(!/^[+-]?\d*\.?\d+$/.test(args[0]))
                throw "ERROR: racking must be a number";
            let newRacking = parseFloat(args.shift());
            let frac = newRacking-Math.floor(newRacking);
            if(frac != 0.0 && frac != .025)
                throw "ERROR: racking must be an integer or an integer+0.25";

            racking = newRacking;
        }else if(op === 'split'){
            let d = args.shift();
            let n = new BedNeedle(args.shift()); //from needle
            let t = new BedNeedle(args.shift()); //to needle
            let cs = args;

            //make sure that 't' and 'n' align reasonably:
            if(n.isBack() && t.isFront()){
                if(n.needle+racking !== t.needle){
                    throw "ERROR: needles '"+n+"' and '"+t
                        +"' are not aligned at racking "+racking+".";
                }
            }else if(n.isFront() && t.isBack()){
                if(n.needle !== t.needle+racking){
                    throw "ERROR: needles '"+n+"' and '"+t
                        +"' are not aligned at racking "+racking+".";
                }
            }
            let op;
            let type;
            //make sure this is a valid operation, and fill in proper OP
            if(n.isHook && t.isHook()){
                if(cs.length === 0){
                    type= TYPE_XFER;
                    if(n.isFront()){
                        xfer('f', n.needle, 'b', t.needle);
                    }else{
                        xfer('b', n.needle, 'f', t.needle);
                    }
                }else{
                    type = TYPE_SPLIT;
                    op = (n.isFront() ? OP_SPLIT_TO_BACK : OP_SPLIT_TO_FRONT);
                }
            }else if(n.isSlider() && t.isHook()){
                if(cs.length === 0) {
                    type = TYPE_XFER_FROM_SLIDERS;
                    op = (n.isFront() ? OP_XFER_TO_BACK : OP_XFER_TO_FRONT);
                }else{
                    throw "ERROR: cannot split from slider.";
                }
            }else if(n.isHook() && t.isSlider()){
                if(cs.length === 0) {
                    type = TYPE_XFER_TO_SLIDERS;
                    op = (n.isFront() ? OP_XFER_TO_BACK : OP_XFER_TO_FRONT);
                }else {
                    type = TYPE_SPLIT_VIA_SLIDERS;
                    op = (n.isFront() ? OP_SPLIT_TO_BACK : OP_SPLIT_TO_FRONT);
                }
            }else{
                throw "ERROR: cannot move from slider to slider.";
            }

            if(cs.length === 0){
                d = ""; //xfer is directionless
            }

            let info = {
                type:type,
                slots:{},
                racking:racking,
                stitch:stitch,
                carriers:cs,
                direction:d
            };

            handleIn(cs, info);

            setLast(cs, d, n);
        }else if(op === 'pause'){
            //no pauses for this
        }else if(op.match(/^x-/)){
            console.warn("WARNING: unsupported extension operation '"+op+"'.");
        }else{
            console.warn("WARNING: unsupported operation '"+op+"'. Ignored.");
        }
    });

    makeTxt();
}

main();

