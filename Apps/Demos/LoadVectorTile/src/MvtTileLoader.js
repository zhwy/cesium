/* eslint-disable no-async-promise-executor */

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

export default class MvtTileLoader {
  constructor(cacheStore) {
    // this.cacheStore = cacheStore;
    // this.cacheStore.init();
  }

  load(resource, cache) {
    return this._load(resource, cache);
  }

  clearCache() {
    // this.cacheStore.reset();
  }

  _load(resource, cache) {
    return new Promise(async (resolve, reject) => {
      // const cacheKey = getCacheKey(resource);
      // if (cache === true) {
      //   try {
      //     const cacheData = await this.cacheStore.get(cacheKey);
      //     if (cacheData) {
      //       resolve(cacheData);
      //       return;
      //     }
      //   } catch (e) {
      //     console.error(e);
      //   }
      // }
      resource
        .fetchArrayBuffer()
        .then((arrayBuffer) => {
          // if (cache === true) {
          //   this.cacheStore.put(cacheKey, arrayBuffer).catch((err) => {
          //     console.warn(err);
          //   });
          // }
          resolve(arrayBuffer);
        })
        .catch((err) => reject(err));
    });
  }

  static instance() {
    if (!instance) {
      instance = new MvtTileLoader();
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
MvtTileLoader.instance();
