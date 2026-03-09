// Reference: https://editor.p5js.org/codingtrain/sketches/Mf74RjP92

let capture;
let faceMesh;
let options = { maxFaces: 1, refineLandmarks: false, flipped: false };
let faces = [];
let erasedPoints = [];
// Define the exterior lip landmark indices for drawing the outer lip contour
let lipsExterior = [
  267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 185,
  40, 39, 37, 0,
];
// Define the interior lip landmark indices for drawing the inner lip contour
let lipsInterior = [
  13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 191,
  80, 81, 82,
];

function preload() {
  faceMesh = ml5.faceMesh(options);
}

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  capture = createCapture({
    video: {
      facingMode: "environment", // use the back camera
    },
    audio: false, // turn off the microphone
  });
  capture.hide();
  fog = createGraphics(width, height);
  fog.background(255, 180);

  // receive data from the server
  socket.on("DrawingFromServer", (data) => {
    eraseFog(data.x * width, data.y * height);
  });

  // Start detecting faces from the webcam video
  faceMesh.detectStart(capture, gotFaces);
}

function draw() {
  push();
  // scale to fullscreen while maintaining aspect ratio
  scale(height / ((width * capture.height) / capture.width));
  //image(capture, 0, 0, width, height);
  image(capture, 0, 0, width, (width * capture.height) / capture.width); // camheight<height
  pop();
  image(fog, 0, 0);

  if (faces.length > 0) {
    let face = faces[0];

    // Draw face keypoints
    for (let i = 0; i < face.keypoints.length; i++) {
      let keypoint = face.keypoints[i];
      stroke(255, 255, 0);
      strokeWeight(1);
      point(keypoint.x, keypoint.y);
    }

    // Draw exterior lip contour
    stroke(255, 255, 0);
    strokeWeight(2);
    noFill();
    beginShape();
    for (let i = 0; i < lipsExterior.length; i++) {
      let index = lipsExterior[i];
      let keypoint = face.keypoints[index];
      vertex(keypoint.x, keypoint.y);
    }
    endShape(CLOSE);

    // Draw interior lip contour
    beginShape();
    for (let i = 0; i < lipsInterior.length; i++) {
      let index = lipsInterior[i];
      let keypoint = face.keypoints[index];
      vertex(keypoint.x, keypoint.y);
    }
    endShape(CLOSE);

    // Get mouth opening distance
    let a = face.keypoints[13];
    let b = face.keypoints[14];
    let d = dist(a.x, a.y, b.x, b.y);
    let x = (a.x + b.x) * 0.5;
    let y = (a.y + b.y) * 0.5;

    if (d > 20 && random(1) < 0.25) {
      // if detected breath, fill fog again gradually
      // only fill the erased parts
      for (let p of erasedPoints) {
        // fill the fog around the mouth
        let distToMouth = dist(p.x, p.y, x, y);
        let currentAlpha = 0; //alpha(fog.get(p.x, p.y));
        if (distToMouth < 100 && currentAlpha < 180) {
          fog.fill(255, 10);
          fog.noStroke();
          fog.circle(p.x, p.y, 20); // only fill the erased points
          //fog.circle(x, y, d * 2); // fill around the mouth
        }
      }
      fog.circle(x, y, d * 2); // fill around the mouth
    }
  }
}

// Callback function for when faceMesh outputs data
function gotFaces(results) {
  // Save the output to the faces variable
  faces = results;
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);
}

// Convenient for socket communication
function eraseFog(x, y) {
  fog.erase();
  fog.noStroke();
  fog.circle(x, y, 20);
  fog.noErase();
  // record the erased points positions
  erasedPoints.push({ x, y });
}

function touchMoved() {
  for (let i = 0; i < touches.length; i++) {
    let x = touches[i].x;
    let y = touches[i].y;
    // fog.erase();
    // fog.circle(x, y, 20);
    // fog.noErase();
    eraseFog(x, y);
    image(fog, 0, 0);

    // send data to the server
    socket.emit("DrawingFromClient", {
      x: x / width,
      y: y / height,
    });
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
