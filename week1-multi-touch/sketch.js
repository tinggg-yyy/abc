let angle = 0;
let a = 0,
  r,
  g,
  b,
  t;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  background(0);
}

function draw() {
  translate(width / 2, height / 2);
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {}

function touchMoved() {
  console.log(touches);

  for (let i = 0; i < touches.length; i++) {
    let x = map(touches[i].x, 0, width, 0, width / 2);
    let y = map(touches[i].y, 0, height, 0, height / 2);
    let s1 = map(touches[i].x, 0, width, 0, 3);
    let s2 = map(touches[i].y, 0, height, 0, 3);

    //color
    r = 250 - 50 * i;
    g = random(80, 130);
    b = random(200, 250);
    t = 10;
    stroke(250, 250, 250, t * i);

    //angle
    a = lerp(a, touches[i].y, 0.001);
    angle = angle + 60.1 + 30.05 * i;

    push();
    fill(r, g, b, t);
    rotate(radians(angle));
    ellipse(a, a, width / 4, height / 4);

    fill(g, r, b, t);
    rotate(radians(angle));
    scale(s1, s2);
    ellipse(x, y, width / 6, height / 6);

    fill(g, b, r, t);
    rotate(radians(angle));
    scale(s1, s2);
    ellipse(width / 2 - x, height / 2 - y, width / 6, height / 6);
    pop();
  }
}

function touchEnded() {
  if (touches.length < 1) {
    clear();
    background(0);
    a = 0;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
