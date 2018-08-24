# Knitout 3D Visualizer
The Knitout 3D Visualizer consists of two programs: knitout-3D-visualizer.js and yarn-to-obj.js
The first takes in a knitout file and converts it to a series of 3D coordinates representing the knitted yarns as polylines.
The second is used for converting the coordinates of the polylines into an .obj for easy viewing. 

## Some details on knitout-3D-visualizer.js
The only knitout operations currently supported are in, inhook, releasehook, out, outhook, tuck, knit, and xfer. "Pause" is also supported as in it does absolutely nothing.

The output file is essentially a long list of coordinates. Each new line marks a new set of coordinates. Each space delineates x, y, and z components of each coordinate. The output file has some strange points that I implemented to make conversion into an .obj easier. The separate yarns knitted by different carriers are marked by lines that say "usemtl mtl*n*" where *n* is some number that represents one of the carrier slots. In older commits, there was also code to indicate where the carriers(shown by a little triangle) should be drawn, which was indicated by the letter *c* in front of a coordinate location.

## Some details on yarn-to-obj.js
[The .obj viewer I used](https://3dviewer.net/) doesn't seem to support lines, so yarn-to-obj.js duplicates all the coordinates in the input file and slightly offsets the duplicated points. It then makes narrow faces out of the original points and duplicated points that end up resembling lines. 

As with knitout-3d-visualizer.js, previous commits allowed yarn-to-obj.js to deal with instructions to draw carrier triangles. 

Other options for viewing the resultant .obj include Blender and Maya.

## Using knitout-3D-visualizer.js and yarn-to-obj.js
Possible ways you would use this code with some knitout file you have called "test.k"
```
node knitout-3D-visualizer.js test.k test.txt
node yarn-to-obj.js test.txt test.obj
```
or
```
node knitout-3D-visualizer.js test.k test.txt && node yarn-to-obj.js test.txt test.obj
```
or
```
./knitout-3D-visualizer.js test.k test.txt && ./yarn-to-obj.js test.txt test.obj
```
