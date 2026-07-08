// function getCacheKey(resource) {
//   return resource.url;
// }

// function calculateSize(items) {
//   let size = 0;
//   for (let i = 0; i < items.length; i++) {
//     const item = items[i];
//     const objectSize = JSON.stringify(item.key).length + item.value.byteLength;
//     size += objectSize * 2;
//   }
//   return size;
// }

let instance;

export default class MVTLoader {
  constructor(cacheStore) {
    // this.cacheStore = cacheStore;
    // this.cacheStore.init();
  }

  load(resource, scheduler, priority) {
    return scheduler.schedule((context) => {
      const promise = resource.fetchArrayBuffer();
      context.onCancel(() => resource.request.cancel());
      return promise;
    }, priority);
  }

  clearCache() {
    // this.cacheStore.reset();
  }

  static instance() {
    if (!instance) {
      instance = new MVTLoader();
      // new IndexDbKvCacheStore(
      //   "wdvt-cache-store",
      //   window.YJ3D_MVT_CACHE_MAX_SIZE_MB || 512,
      //   calculateSize,
      // ),
    }
    return instance;
  }
}
// init
MVTLoader.instance();
