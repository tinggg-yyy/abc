let heart, hx, hy;
let heartActive = false;

function preload() {
  heart = loadImage("assets/love.gif");
}

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  canvas.style("pointer-events", "none");
}

socket.on("heartMove", (data) => {
  hx = data.x;
  hy = data.y;
  heartActive = true;
});

socket.on("heartEnd", () => {
  heartActive = false;
});

function draw() {
clear();
imageMode(CENTER);

if (heartActive) {
  image(heart, hx, hy, 80, 80);
}
}

// P5 touch events: https://p5js.org/reference/#Touch


function touchMoved() {
if (touches.length > 0) {
  hx = touches[0].x;
  hy = touches[0].y;
  heartActive = true;

  socket.emit("heartMove", { x: hx, y: hy });
}
return false;
}


function touchEnded() {
  heartActive = false;
  socket.emit("heartEnd");
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
