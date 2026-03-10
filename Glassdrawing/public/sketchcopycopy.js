// Mouth Open Detection Reference: https://editor.p5js.org/codingtrain/sketches/Mf74RjP92

let capture;
let faceMesh;
let options = { maxFaces: 1, refineLandmarks: false, flipped: false };
let faces = [];
let lines = {}; // lines object, key is userId, value is array of lines for that user
let myFog;
let otherFog;

function preload() {
  faceMesh = ml5.faceMesh(options);
}

function setup() {
  // Create canvas and put it in the container
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  // Webcam
  capture = createCapture({
    video: {
      facingMode: "environment", // use the back camera
    },
    audio: false, // turn off the microphone
  });
  capture.hide();

  // Fog layer
  myFog = createGraphics(width, height);
  myFog.background(255, 180);
  otherFog = createGraphics(width, height);
  otherFog.background(255, 180);

  // Start detecting faces from the webcam video
  faceMesh.detectStart(capture, gotFaces);

  // No Fog at first
  myFog.clear();
  otherFog.clear();

  // Animation Gif to remind people to breathe
  push();
  breathGif = createImg("assets/breathe4.GIF");
  breathGif.position(width / 2 - 400, height / 2 - 200);
  breathGif.size(800, 400);
  breathGif.style("filter", "invert(1)"); // invert color
  breathGif.style("transform", "rotate(90deg)");
  pop();

  //  or other person breathed (cannot put it in draw(){} or too many listeners => lagging)
  socket.on("user-breathed", function () {
    myFog.fill(255, 15);
    myFog.noStroke();
    myFog.rect(0, 0, width, height);
    // other person breathed, so not show the breath gif for me
    breathGif.hide();
  });
}

function draw() {
  // Webcam
  push();
  // scale to fullscreen while maintaining aspect ratio
  scale(height / ((width * capture.height) / capture.width));
  //image(capture, 0, 0, width, height);
  image(capture, 0, 0, width, (width * capture.height) / capture.width); // camheight<height
  pop();

  // automatically fog disappears
  myFog.erase(3, 0);
  myFog.rect(0, 0, width, height);
  myFog.noErase();
  otherFog.erase(3, 0);
  otherFog.rect(0, 0, width, height);
  otherFog.noErase();

  // Face detection
  if (faces.length > 0) {
    let face = faces[0];

    // Get mouth opening distance
    let a = face.keypoints[13];
    let b = face.keypoints[14];
    let d = dist(a.x, a.y, b.x, b.y);
    let x = (a.x + b.x) * 0.5;
    let y = (a.y + b.y) * 0.5;

    if (d > 20 && random(1) < 0.25) {
      // if detected breath, fill fog again gradually
      // (here is actually my phone because of behind camera)
      otherFog.fill(255, 15);
      otherFog.noStroke();
      otherFog.rect(0, 0, width, height);

      // tell server i breathed
      socket.emit("user-breathed", true);

      //not show the breath gif when user breathes
      breathGif.hide();
    }
  }

  // Set transparency of the fog layer
  tint(255, 127);
  image(otherFog, 0, 0);
  // tint(255, 127);
  image(myFog, 0, 0);
}

// Callback function for when faceMesh outputs data
function gotFaces(results) {
  // Save the output to the faces variable
  faces = results;
}

// NEW LINE STARTED
// either I start new line:
function touchStarted() {
  let p = [touches[0].x, touches[0].y];
  if (!lines["me"]) lines["me"] = [];
  lines["me"].push(new MyLine(p));

  // tell server i started line
  socket.emit("new-line-started", p);
}
// or the other phone starts new line:
socket.on("new-line-started", function (point) {
  if (!lines[point.userId]) lines[point.userId] = [];
  // lines[point.userId].push(new MyLine(point.point));
  //flip fog
  let flippedPoint = [point.point[0], height - point.point[1]];
  lines[point.userId].push(new MyLine(flippedPoint));
});

// NEW POINT ON LINE
// either I am drawing:
function touchMoved() {
  let p = [touches[0].x, touches[0].y];
  let myLines = lines["me"];
  myLines[myLines.length - 1].points.push(p);

  // Draw the Fog
  let currentPoints = myLines[myLines.length - 1].points;
  drawOnFog(myFog, currentPoints);

  // tell server about new point
  socket.emit("new-point-on-line", p);
}
// or other person is drawing
socket.on("new-point-on-line", function (point) {
  let userLines = lines[point.userId];
  if (!userLines || userLines.length === 0) return;
  // userLines[userLines.length - 1].points.push(point.point);
  // flip fog
  let flippedPoint = [point.point[0], height - point.point[1]];
  userLines[userLines.length - 1].points.push(flippedPoint);

  let currentPoints = userLines[userLines.length - 1].points;
  drawOnFog(otherFog, currentPoints);
});

function touchEnded() {
  let myLines = lines["me"];
  myLines[myLines.length - 1].finished = true;
  // console.log(myLines);
  // tell server
  socket.emit("new-line-finished", true);
}

// or other person finished line
socket.on("new-line-finished", function (point) {
  let userLines = lines[point.userId];
  if (!userLines || userLines.length === 0) return;
  userLines[userLines.length - 1].finished = true;
  // console.log(userLines);
});

function drawOnFog(fogLayer, points) {
  fogLayer.erase(10, 255);
  fogLayer.strokeWeight(20);
  fogLayer.stroke(0);
  fogLayer.noFill();
  fogLayer.beginShape();
  for (let p of points) {
    fogLayer.vertex(p[0], p[1]);
  }
  fogLayer.endShape();
  fogLayer.noErase();
}

// Lines Object
class MyLine {
  constructor(startPoint) {
    this.points = [startPoint];
    this.created = Date.now();
    this.finished = false;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
