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

//globals

//layer depths
const FRONT_BED = 1;
const BACK_BED = -1;
const CARRIERS = 0;
const FRONT_SLIDERS = 0.5;
const BACK_SLIDERS = -0.5;


var knitoutFile = process.argv[2];
var textFile = process.argv[3];
const fs = require("fs");
var stream = fs.createWriteStream(textFile);
var frontActiveRow = [];
var backActiveRow = [];
var passes = [];

var boxWidth = 1;
var boxHeight = 1;
var boxDepth = 0.1;
var boxSpacing = boxHeight/2;
var carrierSpacing = (FRONT_SLIDERS-CARRIERS)/16;

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

//map is stitch.leading => stitch number
//NOTE: this is the opposite of how the 'stitch' op does it (leading, stitch).
//NOTE: this doesn't do anything with 'YG', also what is YG?
//NOTE: this should probably be read out of a .999 file of some sort
const STITCH_NUMBERS = {
    '10.-10':81,
    '10.0': 82,
    '10.10':83,
    '15.5': 84,
    '15.10':85,
    '15.15':86,
    '20.10':87,
    '20.15':88,
    '20.20':89,
    '25.15':90,
    '25.20':91,
    '25.25':92,
    '30.25':93,
    '35.25':94,
    '40.25':95,
    '45.25':96,
    '50.25':97,
    '55.25':98,
    '60.25':99,
    '65.25':100
};
//these give the expected range of stopping distances:
const MIN_STOPPING_DISTANCE = 10;
const MAX_STOPPING_DISTANCE = 20;
//special op, turns into a MISS if slot is unoccupied, or merges with knit/tuck/etc.
const OP_SOFT_MISS = {color:16};
const OP_MISS_FRONT = {color:216 /*bed:'f'*/}; //116 == front miss (with links process), 216 == front miss (independent carrier movement)
const OP_MISS_BACK  = {color:217 /*bed:'b'*/}; //117 == back miss (with links process), 217 == back miss (independent carrier movement)
//NOTE: this code sometimes uses 216/217 without independent carrier movement, at that seems to be okay(?!?)
const OP_TUCK_FRONT = {color:11, isFront:true /*bed:'f'*/};
const OP_TUCK_BACK	= {color:12, isBack:true /*bed:'b'*/};
const OP_KNIT_FRONT = {color:51, isFront:true /*bed:'f'*/};
const OP_KNIT_BACK	= {color:52, isBack:true /*bed:'b'*/};
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
    if (this.bed === "f" || this.bed === "fs") return true;
    else if (this.bed === "b" || this.bed === "bs") return false;
    else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isBack = function(){
    if (this.bed === "f" || this.bed === "fs") return false;
    else if (this.bed === "b" || this.bed === "bs") return true;
    else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isHook = function(){
    if (this.bed === "f" || this.bed === "b") return true;
    else if (this.bed === "fs" || this.bed === "bs") return false;
    else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isSlider = function(){
    if (this.bed === "fs" || this.bed === "bs") return true;
    else if (this.bed === "f" || this.bed === "b") return false;
    else throw "Invalid bed in BedNeedle.";
};

//Carrier objects store information about each carrier:
function Carrier(name) {
    this.name = name;
    this.last = null; //last stitch -- {needle:, direction:} -- or null if not yet brought in
    this.in = null; //the "in" operation that added this to the active set. (format: {op:"in", cs:["", "", ...]})
}

//Pass stores info on a single machine pass
function Pass(info){
    //type: one of the TYPE_* constants (REQUIRED)
    //racking: number giving racking (REQUIRED)
    //stitch: number giving stitch (REQUIRED)
    //slots: index->operation
    //direction: one of the DIRECTION_* constants
    //carriers: array of carriers, possibly of zero length
    //hook: one of the HOOK_* constants or undefined
    //gripper: one of the GRIPPER_* constants or undefined
    ['type', 'slots', 'direction', 'carriers', 'hook', 'gripper', 'racking',
    'stitch', 'speed', 'presserMode'].forEach(function(name){
        if (name in info) this[name] = info[name];
    }, this);
    if(!('carriers' in this))this.carriers = [];
    //check specs
    console.assert('type' in this, "Can't specify a pass without a type.");
    console.assert('racking' in this, "Can't specify a pass without a racking.");
    console.assert('stitch' in this, "Can't specify a pass without a stitch value.");

    if(this.type === TYPE_KNIT_TUCK){
        if("gripper" in this){
            console.assert(this.carriers.length!==0,
                    "Using GRIPPER_* with no carriers doesn't make sense.");
            if(this.gripper === GRIPPER_IN)
                console.assert(!("hook" in this) || this.hook===HOOK_IN,
                        "Must use GRIPPER_IN with HOOK_IN.");
            else if(this.gripper === GRIPPER_OUT)
                console.assert(!("hook" in this) || this.hook===HOOK_OUT,
                        "Must use GRIPPER_OUT with HOOK_OUT.");
            else
                console.assert(false,
                        "Pass gripper must be one of the GRIPPER_* constants.");
        }
        if("hook" in this){
            if(this.hook === HOOK_IN){
                console.assert(this.carriers.length!==0,
                        "Using HOOK_IN with no carriers doesn't make sense.");
            }else if(this.hook === HOOK_RELEASE){
                //HOOK_RELEASE can work with any carriers
            }else if(this.hook === HOOK_OUT){
                console.assert(this.carriers.length!==0,
                        "Using HOOK_OUT with no carriers doesn't make sense.");
            }else{
                console.assert(false,
                        "Pass hook must be one of the HOOK_* constants.");
            }
        }
    }else if(this.type === TYPE_SPLIT) {
        console.assert(!("gripper" in this),
                "Must use gripper enly on KNIT_TUCK pass.");
        console.assert(!("hook" in this),
                "Must use hook only on KNIT_TUCK pass.");
        console.assert(this.carrers.length>0,
                "Split passes should have yarn.");
    }else if(this.type === TYPE_XFER || this.type === TYPE_XFER_TOSLIDERS
            || this.type === TYPE_XFER_FROM_SLIDERS){
        console.assert(!("gripper" in this),
                "Must use gripper only on KNIT_TUCK pass.");
        console.assert(!("hook" in this),
                "Must use gripper only on KNIT_TUCK pass.");
        console.assert(this.carriers.length === 0,
                "Transfer passes cannot have carriers specified.");
    }else{
        console.assert(false, "Pass type must be on of the TYPE_* constants.");
    }
}
Pass.prototype.hasFront = function(){
    console.assert(this.type === TYPE_KNIT_TUCK,
            "It only makes sense for knit-tuck passes to have front stitches.");
    for(let s in this.slots){
        if("isFront" in this.slots[s]) return true;
    }
    return false;
};
Pass.prototype.hasBack = function(){
    console.assert(this.type === TYPE_KNIT_TUCK,
            "It only makes sense for knit-tuck passes to have back stitches.");
    for(let s in this.slots){
        if("isBack" in this.slots[s]) return true;
    }
    return false;
};
Pass.prototype.append = function(pass){
    if(!["type", "racking", "stitch", "direction", "carriers"].every(function(name){
        return JSON.stringify(this[name])===JSON.stringify(pass[name]);
    }, this)){
        return false;
    }

    if(!("hook" in this) && !("hook" in pass)){
        //hook in neither is fine
    }else if(this.hook === HOOK_IN && !("hook" in pass)){
        //in at start of current pass is fine
    }else if(!("hook" in this) &&
            (pass.hook === HOOK_OUT||pass.hook===HOOK_RELEASE)){
        //out or release at the end of the next pass is fine
    }else{
        return false;
    }

    if(!("gripper" in this) && !("gripper" in pass)){
        //gripper in neither is fine
    }else if(this.gripper === GRIPPER_IN && !("gripper" in pass)){
        //in at the start of the current pass is fien
    }else if(!("gripper" in this) && pass.gripper === GRIPPER_OUT){
        //out at the end of the next pass is fine
    }else{
        return false;
    }
    let quarterPitch = (this.racking-Math.floor(this.racking)) != 0.0;
    if(this.direction === DIRECTION_RIGHT){
        //new operation needs to be on the right of other ops
        let max = -Infinity;
        for(let s in this.slots)
            max = Math.max(max, parseInt(s));
        for(let s in pass.slots){
            s = parseInt(s);
            if (s<max)
                return false;
            else if(s===max){
                if(merge_ops(this.slots[s], pass.slots[s], quarterPitch)
                        === null){
                    return false;
                }
            }
        }
    }else if(this.direction === DIRECTION_LEFT){
        let min = Infinity;
        for(let s in this.slots){
            min = Math.min(min, parseInt(s));
        }
        for(let s in pass.slots){
            s = parseInt(s);
            if(s>min){
                return false;
            }else if(s===min){
                if(merge_ops(pass.slots[s], this.slots[s], quarterPitch)
                        === null){
                    return false;
                }
            }
        }
    }else{
        console.assert(this.direction === DIRECTION_NONE,
                "'"+this.direction+"' must be a DIRECTION_* constant.");
        for(let s in pass.slots){
            if(s in this.slots){
                if(merge_ops(this.slots[s], pass.slots[s], quarterPitch)
                        ===null
                        &&merge_ops(pass.slot[s], this.slot[s], quarterPitch)
                        ===null){
                    return false;
                }
            }
        }
    }
    //merge hook and gripper properties
    if(!("hook" in this) && ("hook" in pass))
        this.hook = pass.hook;
    else
        console.assert(!("hook" in pass), "we checked this");
    if(!("gripper" in this) && ("gripper" in pass))
        this.gripper = pass.gripper;
    else
        console.assert(!("gripper" in pass), "we checked this");

    //merge slots
    for(let s in pass.slots){
        if(s in this.slots){
            if(this.direction === DIRECTION_RIGHT){
                this.slots[s]=
                    merge_ops(this.slots[s], pass.slots[s], quarterPitch);
            }else if(this.direction === DIRECTION_LEFT){
                this.slots[s] =
                    merge_ops(pass.slots[s], this.slots[s], quarterPitch);
            }else{
                console.assert(this.direction === DIRECTION_NONE,
                        "Direction must a DIRECTION_* constants");
                let op = merge_ops(this.slots[s],pass.slots[s],quarterPitch);
                if(op===null)
                    op = merge_ops(pass.slots[s],pass.slots[s],quarterPitch);
                this.slots[s] = op;
            }
        }else{
            this.slots[s] = pass.slots[s];
        }
    }
    return true;
};

//stores points for the entire knitted yarn thing
let yarn = [];

//stores things for each new pass with yarn
function yarnPass(floops, bloops, direction){
    this.bloops = bloops;
    this.floops = floops;
    this.direction = direction;
}

//stored in array of active loops. Its a row and a needle number used to access
//the object in the "yarn" array
function loopSpec(row){
    this.row = row;
    this.n = 1;
}

//stores things for each needle with yarn on it
function loop(pts, carrier){
    //ctrlPts: the coordinates of each point on the loop
    this.ctrlPts = pts;
    this.carrier = carrier;
}


function format(x, y, z){
    return x+" "+y+" "+z+"\n";
}

function errorHandler(err, data){
    if(err) return console.error(err);
}

//gets yarn "height" of neighbors
function neighborHeight(bed, needle){
    let left = needle-1;
    let right = needle-1;
    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);
    while(left>=0||right<activeRow.length){
        if(left>=0){
            if(activeRow[left]){
                let row = activeRow[left].row;
                if((bed==='f' && yarn[row].floops[left])
                        ||(bed==='b' && yarn[row].bloops[left]))
                    return minHeight(activeRow[left], bed, left);
            }
            left--;
        }
        if(right<activeRow.length){
            if(activeRow[right]){
                let row = activeRow[right].row;
                if((bed==='f'&& yarn[row].floops[right])
                        ||(bed==='b'&&yarn[row].bloops[right]))
                    return minHeight(activeRow[right], bed, right);
            }
            right++;
        }
    }
    return 0;
}

//gets lowest "height" of a stitch on a certain active needle
function minHeight(needleSpec, bed, needle){

    let min = Infinity;
    let loops = (bed==='f' ? yarn[needleSpec.row].floops[needle]
            : yarn[needleSpec.row].bloops[needle]);
    for(let i = 0; i<loops.length; i++){
        min = Math.min(min, loops[i].ctrlPts[0][1]);
    }
    return min;
}

/*basic knitout functions
 * each should take:
 *  -start: array of components of the start position
 *  -direction: direction of the current pass,
 *  -bed: the needle bed
 */

function tuck(row, direction, bed, needle, carrier){
    let info = [];
    let dx = boxWidth/5;
    let dy =  boxHeight/3;
    let dz = boxDepth/2;

    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);
    let height = (activeRow[needle] ?
            minHeight(activeRow[needle], bed, needle)+boxSpacing
            : neighborHeight(bed, needle));
    let start = [needle*boxWidth, height, 0];


    if(direction == "-") dx*= -1;
    else start[0] -= boxWidth;

    if(bed=="b"){
        dz*=-1;
        start[2] = BACK_BED;
    }else{
        start[2] = FRONT_BED;
    }

    let x = start[0];
    let y = start[1];
    let z = start[2];

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

    let newLoop = new loop(info, carrier);
    if(yarn[row]){
        let yarnLoops = (bed==='f' ? yarn[row].floops : yarn[row].bloops);
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
        yarn[row] = new yarnPass(newFloop, newBloop, direction);
    }

    if(!activeRow[needle]){
        activeRow[needle] = new loopSpec(row);
    }else{
        activeRow[needle].row = [row];
        activeRow[needle].n++;
    }
}

function knit(row, direction, bed, needle, carrier){
    let info = [];
    let dx = boxWidth/5;
    let dy =  boxHeight/3;
    let dz = boxDepth/2;

    let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);
    let height = (activeRow[needle] ?
            minHeight(activeRow[needle], bed, needle)+boxSpacing
            : neighborHeight(bed, needle));
    let start = [needle*boxWidth, height, 0];


    if(direction == "-") dx*= -1;
    else start[0] -= boxWidth;

    if(bed=="b"){
        dz*=-1;
        start[2] = BACK_BED;
    }else{
        start[2] = FRONT_BED;
    }

    let x = start[0];
    let y = start[1];
    let z = start[2];

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

    let newLoop = new loop(info, carrier);
    if(yarn[row]){
        let yarnLoops = (bed==='f' ? yarn[row].floops : yarn[row].bloops);
        console.assert(!yarnLoops[needle],
                "same row same spot shouldn't be able to have two knits");
        yarnLoops[needle] = [newLoop];
    }else{
        let newFloop = [];
        let newBloop = [];
        if(bed==='f'){
            newFloop[needle] = [newLoop];
        }else
            newBloop[needle] = [newLoop];
        yarn[row] = new yarnPass(newFloop, newBloop, direction);
    }

    activeRow[needle] = new loopSpec(row);
}

function xfer(fromSide, fromNeedle, toSide, toNeedle){
    let fromActiveRow = (fromSide==='f' ? frontActiveRow : backActiveRow);
    let toActiveRow = (toSide==='f' ? frontActiveRow : backActiveRow);
    if(!fromActiveRow[fromNeedle]){
        console.warn("Hmmm why are you trying to transfer from a needle without yarn? Ignored the instruction for now");
        return;
    }

    let specs = fromActiveRow[fromNeedle];
    let info = (fromSide==='f' ? yarn[specs.row].floops[fromNeedle]
            : yarn[specs.row].bloops[fromNeedle]);

    let height = (toActiveRow[toNeedle] ?
            minHeight(toActiveRow[toNeedle], toSide, toNeedle)
            : neighborHeight(toSide, toNeedle));
    let dx = (info[0].ctrlPts[1][0]-info[0].ctrlPts[0][0])/2;
    let dy =  boxHeight/3;
    let dz = boxDepth/2;
    let dir = (dx<0 ? "-" : "+");
    let start = [toNeedle*boxWidth, height, 0];

    if(dir === '+') start[0]-=boxWidth;

    if(toSide == "b"){
        dz*=-1;
        start[2] = BACK_BED;
    }else{
        start[2] = FRONT_BED;
    }

    let x = start[0];
    let y = start[1];
    let z = start[2];

    x += 2*dx;
    z -= dz;

    y += dy;
    z += 2*dz;

    x -= dx;
    for(let i = 0; i<info.length; i++){
        info[i].ctrlPts[3] = [x, y, z];
    }

    y += dy;
    for(let i = 0; i<info.length; i++){
        info[i].ctrlPts[4] = [x, y, z];
    }

    x += dx;
    z -= 2*dz;
    for(let i = 0; i<info.length; i++){
        info[i].ctrlPts[5] = [x, y, z];
    }

    x += dx;
    for(let i = 0; i<info.length; i++){
        info[i].ctrlPts[6] = [x, y, z];
    }

    x += dx;
    z += 2*dz;
    for(let i = 0; i<info.length; i++){
        info[i].ctrlPts[7] = [x, y, z];
    }

    y -= dy;
    for(let i = 0; i<info.length; i++){
        info[i].ctrlPts[8] = [x, y, z];
    }

    x -= dx;

    y -= dy;
    z -= 2*dz;

    x += 2*dx;
    z += dz;

    if(toActiveRow[toNeedle]){
        toActiveRow[toNeedle].n += fromActiveRow[fromNeedle].n;
    }else{
        toActiveRow[toNeedle] = new loopSpec(fromActiveRow[fromNeedle].row);
        toActiveRow[toNeedle].n = fromActiveRow[fromNeedle].n;
    }

    let destRow = yarn[toActiveRow[toNeedle].row];
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
            if(toSide=='f')
                destRow.floops[toNeedle] = [newLoop];
            else
                destRow.bloops[toNeedle] = [newLoop];
        }
    }
    info = undefined;
    fromActiveRow[fromNeedle] = undefined;
}

function makeTxt(){
    let mostRecentC;
    for(let row = 0; row<yarn.length; row++){
        let dir = yarn[row].direction;
        let yarnRow = yarn[row];
        let maxNeedle = Math.max(yarnRow.floops.length, yarnRow.bloops.length);
        for(let col = 0; col<maxNeedle; col++){
            let needle = col;
            if(dir == '-') needle = maxNeedle-col-1;

            let loop = yarnRow.floops[needle];
            if(loop){
                for(let i = 0; i<loop.length; i++){
                    let pts = loop[i].ctrlPts;
                    let carrier = loop[i].carrier;
                    if(carrier!=mostRecentC){
                        stream.write("usemtl mtl"+carrier+"\n");
                        mostRecentC = carrier;
                    }
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
                    let carrier = loop[i].carrier;
                    if(carrier!=mostRecentC){
                        stream.write("usemtl mtl"+carrier+"\n");
                        mostRecentC = carrier;
                    }
                    for(let j = 0; j<pts.length; j++){
                        let pt = pts[j];
                        stream.write(format(pt[0], pt[1], pt[2]));
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
            if(inInfo.op === "in"){
                info.gripper = GRIPPER_IN;
            }else if(inInfo.op === "inhook"){
                info.gripper = GRIPPER_IN;
                info.hook = HOOK_IN;
                if(hook !== null)
                    throw "ERROR: can't bring in "+JSON.stringify(cs)
                        +" with hook; hook is holding "+JSON.stringy(hook.cs);
                hook = {direction: info.direction, cs:cs.slice()};
            }else{
                console.assert(false, "inInfo.op must be 'in' or 'inhook'.");
            }
        }
    }

    /*
     * currently it seems like the visualizer is fine without merging and just
     * pushing the new pass onto passes. Haven't tested enough to feel safe just
     * removing all calls to merge though.
     */
    function merge(pass, shouldNotKick) {
        if(passes.length !== 0 && passes[passes.length-1].append(pass)){
            //merged fine
        }else{
            //starting a new pass
            //If there are carriers, make sure they start on pass'scorrect side:
            //which slot is this pass acting on?
            let passSlot;
            for(let s in pass.slots){
                console.assert(typeof(passSlot)==="undefined",
                        "only one slot in pass to merge");
                passSlot = parseInt(s);
            }
            console.assert(typeof(passSlot)!=="undefined",
                    "only one slot in pass to merge");
            //which carriers are on the wrong side of this slot?
            let slotCs = {};
            let haveKick = false;
            function addKick(c, slot){
                if(!(slot in slotCs)) slotCs[slot] = [c];
                else slotCs[slot].push(c);
                haveKick = true;
            }
            pass.carriers.forEach(function(c){
                console.assert(c in carriers,
                        "Carriers in Passes should also be in the carrier set.");
                if(carriers[c].last !==null){ //only kick carriers not brought in
                    let carrierSlot = slotNumber(carriers[c].last.needle);
                    if(carriers[c].last.direction === DIRECTION_LEFT){
                        //carrier is somewhere(1 'stopping distance, modulo racking)
                        //left of carrierSlot
                        //
                        //strict version-> "infinite" stopping distance:
                        if(pass.direction === DIRECTION_LEFT){
                            addKick(c, carrierSlot);
                        }else{
                            if(carrierSlot>passSlot)
                                addKick(c, passSlot);
                        }
                    }else{
                        console.assert(carriers[c].last.direction===DIRECTION_RIGHT,
                                "Carrier directions are only LEFT or RIGHT.");
                        if(pass.direction === DIRECTION_RIGHT)
                            addKick(c, carrierSlot);
                        else{
                            if(carrierSlot<passSlot)
                                addKick(c, passSlot);
                        }
                    }
                }
            });

            //if kicks are needed, do recursively
            if(haveKick){
                let d; //direction to kick carrier
                if(pass.direction === DIRECTION_LEFT) d = DIRECTION_RIGHT;
                else if(pass.direction === DIRECTION_RIGHT) d = DIRECTION_LEFT;
                else console.assert(false,
                        "Passes with carriers have either LEFT or RIGHT direction.");
                for(let slot in slotCs){
                    let info = {
                        type:TYPE_KNIT_TUCK,
                        slots:{},
                        racking:racking,
                        stitch:stitch,
                        carriers:slotCs[slot],
                        direction:d
                    };
                    info.slots[slot] = OP_SOFT_MISS;
                    merge(new Pass(info), true);

                    //update carrier last stitch info:
                    slotCs[slot].forEach(function(c){
                        carriers[c].last = {
                            needle:new BedNeedle('f', parseInt(slot)),
                            minDistance:MIN_STOPPING_DISTANCE,
                            direction:d
                        };
                    });
                }

                merge(pass, true);
                return;
            }else{
                //if no kicks, then append pass
                passes.push(pass);
            }
        }
    }

    //update the .last member of the given carriers
    function setLast(cs, d, n){
        console.assert(typeof(n)==='object', "setLast needs a needle.");
        cs.forEach(function(c){
            console.assert(c in carriers, "carrier not in carrier set");
            carriers[c].last =
            {needle:n, direction:d, minDistance:MIN_STOPPING_DISTANCE};
        });
    }

    //if carriers not named in "cs" have last set, kick so they won't overlap n
    function kickOthers(n, cs){
        let ignore = {};
        cs.forEach(function(c){
            ignore[c] = true;
        });
        let needleSlot = slotNumber(n);
        for(let c in carriers){
            let carrier = carriers[c];
            if(carrier.name in ignore) continue;
            if(carrier.last === null) continue;
            let carrierSlot = slotNumber(carrier.last.needle);
            if(carrier.last.direction === DIRECTION_LEFT){
                if(carrierSlot<=needleSlot) continue;
                let info = {
                    type:TYPE_KNIT_TUCK,
                    slots:{},
                    racking:racking,
                    stitch:stitch,
                    carriers:[carrier.name],
                    direction:DIRECTION_RIGHT
                };
                info.slots[slotString(carrier.last.needle)] = OP_SOFT_MISS;
                merge(new Pass(info));
                carrier.last.direction = DIRECTION_RIGHT;
            }else{
                console.assert(carrier.last.direction===DIRECTION_RIGHT,
                        "carriers direction must be LEFT or RIGHT");
                if(carrierSlot>=needleSlot) continue;
                let info = {
                    type:TYPE_KNIT_TUCK,
                    slots:{},
                    racking:racking,
                    stitch:stitch,
                    carriers:[carrier.name],
                    direction:DIRECTION_LEFT
                };
                info.slots[slotString(carrier.last.needle)] = OP_SOFT_MISS;
                merge(new Pass(info));
                carrier.last.direction = DIRECTION_LEFT;
            }
        }
    }

    let lines = fs.readFileSync(knitoutFile, "utf8").split("\n");
    (function checkVersion(){
        let m = lines[0].match(/^;!knitout-(\d+)$/);
        if(!m)
            throw "File does not start with knitout magic string";
        if(parseInt(m[1])>2)
            console.warn("WARNING: File is version "+m[1]
                    +", but this code only knows about versions up to 2.");
    })();

    let carriers = {}; //each are a name=>object map
    let hook = null;
    let racking = 0.0; //starts centered
    let stitch = 5; //machine-specific stitch number

    lines.forEach(function(line, lineIdx){
        let i = line.indexOf(";");
        if(i>=0) line = line.substr(0,i);
        let tokens = line.split(/[ ]+/);

        if(tokens.length>0 && tokens[0] ==="") tokens.shift();
        if(tokens.length>0 && tokens[tokens.length-1] === "") tokens.pop();

        if(tokens.length == 0) return;

        let op = tokens.shift();
        let args = tokens;

        //handle synonyms
        if(op === "amiss"){
            op = "tuck";
            args.unshift("+");
        }else if(op === "drop"){
            op = "knit";
            args.unshift("+");
        }else if(op === "xfer"){
            op = "split";
            args.unshift("+");
        }

        if(op === "in" || op === "inhook"){
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
        }else if(op === "releasehook"){
            let cs = args;
            if(hook === null){
                throw "ERROR: Can't releasehook on "+cs+", it's empty.";
            }else if(JSON.stringify(hook.cs) !== JSON.stringify(cs)){
                throw "ERROR: Can't releasehook on "+cs+
                    ", hook currently holds "+hook+".";
            }
            let needPass = true;
            if(passes.length>0){
                let prev = passes[passes.length-1];
                if(prev.type === TYPE_KNIT_TUCK && !("hook" in prev)
                        &&prev.direction === hook.direction){
                    prev.hook = HOOK_RELEASE;
                    needPass = false;
                }
            }
            if(needPass){
                //an attempt to release hook on an empty pass
                let info = {
                    type:TYPE_KNIT_TUCK,
                    direction:hook.direction,
                    carriers:[],
                    racking:racking,
                    stitch:stitch,
                    hook:HOOK_RELEASE,
                    slots:{}
                };
                info.slots[slotString(carriers[cs[0]].last.needle)] =
                    OP_SOFT_MISS;
                passes.push(new Pass(info));
            }
            //hook is now empty
            hook = null;
        }else if (op === "out" || op === "outhook"){
            let cs = args;
            cs.forEach(function(c){
                if(!(c in carriers))
                    throw "ERROR: Can't bring out inactive carrier '"+c+".";
                if(!carriers[c].last){
                    throw "ERROR: Can't bring out carrier '"+c
                        +"---it asn't yet stitched.";
                }
            });

            if(op === "outhook" && hook !==null)
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
            let info = {
                type:TYPE_KNIT_TUCK,
                slots:{},
                racking:racking,
                stitch:stitch,
                carriers:cs,
                direction: DIRECTION_RIGHT,
                gripper:GRIPPER_OUT
            };
            info.slots[slotString(n)] = OP_SOFT_MISS;

            if(op === "outhook") info.hook = HOOK_OUT;
            merge(new Pass(info));

            //remove carriers from active set:
            cs.forEach(function(c){
                delete carriers[c];
            });

        }else if(op === "tuck"|| op === "knit"){
            let d = args.shift();
            let n = new BedNeedle(args.shift());
            let cs = args;

            if(cs.length === 0){
                if(op === "miss")
                    throw "ERROR: it makes no sense to miss with no yarns.";
                else
                    d = DIRECTION_NONE; //miss and drop are directionless
            }

            if(op !== "miss"){
                kickOthers(n, cs);
            }

            let type;
            if(op === "miss" && cs.length === 0){
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

            if(op === "miss") info.slots[slotString(n)] =
                (n.isFront() ? OP_MISS_FRONT : OP_MISS_BACK);
            else if(op === "tuck"){
                if(n.isFront()){
                    info.slots[slotString(n)] = {color: 11, isFront: true};
                }else{
                    info.slots[slotString(n)] = {color:12, isBack:true};
                }
            }else if(op === "knit"){
                 if(n.isFront()){
                    info.slots[slotString(n)] = {color: 51, isFront: true};
                }else{
                    info.slots[slotString(n)] = {color:52, isBack:true};
                }
            }else console.assert(false, "op was miss, tuck, or knit");

            info.slots[slotString(n)].carrier = cs[0];
            handleIn(cs, info);
            merge(new Pass(info));
            setLast(cs, d, n);
        } else if(op === "rack"){
            if(args.length !== 1) throw "ERROR: racking takes one argument";
            if(!/^[+-]?\d*\.?\d+$/.test(args[0]))
                throw "ERROR: racking must be a number";
            let newRacking = parseFloat(args.shift());
            let frac = newRacking-Math.floor(newRacking);
            if(frac != 0.0 && frac != .025)
                throw "ERROR: racking must be an integer or an integer+0.25";

            racking = newRacking;
        }else if(op === "split"){
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
                    type = TYPE_XFER;
                    op = (n.isFront() ? OP_XFER_TO_BACK : OP_XFER_TO_FRONT);
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
            kickOthers(n, cs);

            let info = {
                type:type,
                slots:{},
                racking:racking,
                stitch:stitch,
                carriers:cs,
                direction:d
            };
            info.slots[slotString(n)] = op;

            handleIn(cs, info);
            merge(new Pass(info));
            setLast(cs, d, n);
        }else if(op === "pause"){
            //no pauses for this
        }else if(op.match(/^x-/)){
            console.warn("WARNING: unsupported extension operation '"+op+"'.");
        }else{
            console.warn("WARNING: unsupported operation '"+op+"'. Ignored.");
        }
    });

    let minSlot = Infinity;
    let maxSlot = -Infinity;
    passes.forEach(function(pass){
        for(let s in pass.slots){
            let si = parseInt(s);
            minSlot = Math.min(minSlot, si);
            maxSlot = Math.max(maxSlot, si);
        }
    });
    console.log("Slots lie in ["+minSlot+", "+maxSlot+"].");

    let row = 0;
    passes.forEach(function(pass){
        let direction;
        let empty = true; //pass is all soft misses
        for(let s in pass.slots){
            let needle = parseInt(s);
            let color = pass.slots[s].color;
            let carrier = pass.slots[s].carrier;
            direction = pass.direction;
            if(color !==16) empty = false;

            if(color == 11){
                tuck(row, direction, 'f', needle, carrier);
            }else if(color == 12){
                tuck(row, direction, 'b', needle, carrier);
            }else if(color == 51){
                knit(row, direction, 'f', needle, carrier);
            }else if(color == 52){
                knit(row, direction, 'b', needle, carrier);
            }else if(color == 30){
                //xfer back to front
                xfer('b', needle-pass.racking, 'f', needle);
            }else if(color == 20){
                //xfer front to back
                xfer('f', needle, 'b', needle-pass.racking);
            }
            else if(color == 16){
                //soft miss: do nothing?
            }else{
                console.log(color+": not yet implemented");
            }
        }
        if (pass.type === TYPE_KNIT_TUCK && !empty){
            row++;
        }
    });

    makeTxt();

    let lastPass = passes[passes.length-1];
    lastPass.carriers.forEach(function(c){
        if(c in carriers){
            let lastNeedle = parseInt(carriers[c].last.needle.needle);
            let bed = carriers[c].last.needle.bed;
            let activeRow = (bed==='f' ? frontActiveRow : backActiveRow);

            let height = (activeRow[lastNeedle] ?
                minHeight(activeRow[lastNeedle], bed, lastNeedle)+boxSpacing
                : neighborHeight(bed, lastNeedle));

            if(lastPass.direction == '+') lastNeedle += 2;
            else lastNeedle -= 2;

            //yarn going to the carrier
            let xstart = lastNeedle*boxWidth;
            let dx = boxWidth/6;
            let dy = boxHeight/4;
            let start = [xstart, height,CARRIERS+carrierSpacing*c];
            stream.write(format(start[0], start[1], start[2]));

            start[0]-=dx;
            start[1]+=dy;
            stream.write(format(start[0], start[1], start[2]));

            start[0]+=2*dx;
            stream.write(format(start[0], start[1], start[2]));

            //carrier
            xstart = lastNeedle*boxWidth;
            start = [xstart, height,CARRIERS+carrierSpacing*c];
            stream.write("c "+format(start[0], start[1], start[2]));

            start[0]-=dx;
            start[1]+=dy;
            stream.write("c "+format(start[0], start[1], start[2]));

            start[0]+=2*dx;
            stream.write("c "+format(start[0], start[1], start[2]));
        }
    });

}

main();
