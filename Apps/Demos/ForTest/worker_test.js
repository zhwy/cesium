import createTaskProcessorWorker from "../../../Build/CesiumUnminified/Workers/createTaskProcessorWorker.js";

function workerTest(parameters, transferableObjects) {
  console.log({ parameters, transferableObjects });
  return "ok!";
}

export default createTaskProcessorWorker(workerTest);
