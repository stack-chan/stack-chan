export default class TaskTrace {
  static begin(id) @ "xs_task_trace_begin"
  static end(id) @ "xs_task_trace_end"
  static get active() @ "xs_task_trace_active"
  static capture(milliseconds) @ "xs_task_trace_capture"
  static get droppedWrites() @ "xs_task_trace_dropped"
  static take() @ "xs_task_trace_take"
}
