/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

let Digital;

function onRobotCreated(_, d) {
  Digital = d
}

let count = 0;

function onButtonChange(button, pressed) {
  if (!pressed) {
    return
  }
  switch (button) {
    case 'A':
      count += 1;
      Digital.write(21, count & 1)
      break
    case 'B':
      break
    case 'C':
      break
  }
}

export default {
  onRobotCreated,
  onButtonChange
}
