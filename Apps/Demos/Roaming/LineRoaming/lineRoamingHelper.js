class LineRoamingHelper {
  constructor(viewer) {
    this.viewer = viewer;
    this.roamPath = null; // 漫游路径
    this.dataSource = new Cesium.CzmlDataSource("line-roaming");
    this.viewer.dataSources.add(this.dataSource).then(() => {
      this.clock = this.dataSource.clock;
    });
    this.startTime = Cesium.JulianDate.fromDate(new Date(2020, 1, 1, 0));
  }
  setRoamPath(positions) {
    const sampledPos = new Cesium.SampledPositionProperty();
  }
}
export default LineRoamingHelper;
