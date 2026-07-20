export default class CommonUtils {
  static isPlainObject(value) {
    return (
      typeof value === "object" &&
      value !== null &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    );
  }

  static cloneValue(value) {
    if (Array.isArray(value)) {
      return value.map(CommonUtils.cloneValue);
    }
    if (CommonUtils.isPlainObject(value)) {
      const result = {};
      Object.keys(value).forEach((key) => {
        result[key] = CommonUtils.cloneValue(value[key]);
      });
      return result;
    }
    return value;
  }

  static isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }
}
