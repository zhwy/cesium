define(function () {
  "use strict";

  const test = (e) => {
    console.log("got", e);
    try {
      return Promise.resolve("ok!");
    } catch (e) {
      return Promise.reject(e);
    }
  };

  function worker_test(event) {
    const data = event.data;
    const promise = test(data.parameters);
    const responseMessage = {
      id: data.id,
      result: undefined,
      error: undefined,
    };
    return promise
      .then((res) => {
        responseMessage.result = res;
      })
      .catch((e) => {
        responseMessage.error = e;
      })
      .finally(() => {
        postMessage(responseMessage);
      });
  }

  return worker_test;
});
