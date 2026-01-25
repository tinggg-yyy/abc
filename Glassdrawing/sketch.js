let capture;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  capture = createCapture(VIDEO);
  capture.hide();
  fog = createGraphics(width, height);
  fog.background(255, 180);
}

function draw() {
  push();
  scale(-1, 1);
  image(capture, 0, 0, width, height);
  pop();
  image(fog, 0, 0);
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);
}

function touchMoved() {
  for (let i = 0; i < touches.length; i++) {
    let x = touches[i].x;
    let y = touches[i].y;
    fog.erase();
    fog.circle(x, y, 20);
    fog.noErase();
    image(fog, 0, 0);
  }
}

function touchEnded() {}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
