import turf from './turf.js'
class Tin {
	constructor(points, edges) {
		this.pointCount = points.length;
		this.edges = edges;
		this.points = points;
		this.indices = [];

		this.edgePolylines = turf.multiLineString(edges);
		this.edgePolygons = turf.polygonize(this.edgePolylines);
	}
	/**
	 * 找到最近的两个高程点构成初始边界
	 */
	getStartPoints() {
		let minDistanceSquared = Number.POSITIVE_INFINITY;
		let index1, index2;
		for (let i = 0; i < this.pointCount; i += 1) {
			const pi = this.points[i];
			for (let j = i + 1; j < this.pointCount; j += 1) {
				const pj = this.points[j];
				const line = turf.lineString([pi, pj]);
				if (turf.booleanIntersects(line, this.edgePolygons)) {
					continue;
				}
				const distanceSquared =
					(pi[0] - pj[0]) * (pi[0] - pj[0]) +
					(pi[1] - pj[1]) * (pi[1] - pj[1]);
				if (distanceSquared < minDistanceSquared) {
					index1 = i;
					index2 = j;
					minDistanceSquared = distanceSquared;
				}
			}
		}
		return {
			index1,
			index2,
		};
	}
	/**
	 * 获取最近点下标
	 * @param {*} x
	 * @param {*} y
	 */
	getNearestPointIndex(x, y, excluded) {
		let minDistanceSquared = Number.POSITIVE_INFINITY;
		let index = -1;
		for (let i = 0; i < this.pointCount; i += 1) {
			if (!excluded.includes(i)) {
				const point = this.points[i];
				const distanceSquared =
					(point[0] - x) * (point[0] - x) +
					(point[1] - y) * (point[1] - y);

				if (distanceSquared < minDistanceSquared) {
					index = i;
					minDistanceSquared = distanceSquared;
				}
			}
		}
		return index;
	}
	/**
	 * 判断短此边是否已重复两次
	 * @param {*} index1
	 * @param {*} index2
	 * @param {*} triangleCount
	 * @returns
	 */
	edgeNotRepeatTwice(index1, index2, triangleCount) {
		let sum = 0;
		for (let i = 0; i < triangleCount; i++) {
			const idx1 = this.indices[i * 3];
			const idx2 = this.indices[i * 3 + 1];
			const idx3 = this.indices[i * 3 + 2];

			if (
				(index1 === idx1 && index2 === idx2) ||
				(index1 === idx2 && index2 === idx1) ||
				(index1 == idx1 && index2 === idx3) ||
				(index1 === idx3 && index2 === idx1) ||
				(index1 === idx2 && index2 === idx3) ||
				(index1 === idx3 && index2 === idx2)
			) {
				sum++;
				if (sum === 2) return false;
			}
		}

		return true;
	}
	/**
	 * 计算余弦
	 * @param {*} pt1
	 * @param {*} pt2
	 * @param {*} pt3
	 * @returns
	 */
	cos(pt1, pt2, pt3) {
		const vector31 = {
			x: pt1[0] - pt3[0],
			y: pt1[1] - pt3[1],
		};
		const vector32 = {
			x: pt2[0] - pt3[0],
			y: pt2[1] - pt3[1],
		};

		const length1 = Math.sqrt(
			vector31.x * vector31.x + vector31.y * vector31.y
		);

		const length2 = Math.sqrt(
			vector32.x * vector32.x + vector32.y * vector32.y
		);

		return (
			(vector31.x * vector32.x + vector31.y * vector32.y) /
			(length1 * length2)
		);
	}
	/**
	 * 点是否在同侧
	 * @param {*} pt1
	 * @param {*} pt2
	 * @param {*} pt3
	 * @param {*} pt4
	 * @returns
	 */
	pointNotOnSameSide(pt1, pt2, pt3, pt4) {
		// 是否与边界相交
		const trianlge = turf.polygon([[pt1, pt2, pt4, pt1]]);
		const polygons = this.edgePolygons.features;
		for (let i = 0; i < polygons.length; i += 1) {
			if (turf.intersect(polygons[i], trianlge)) {
				return false;
			}
		}

		if (pt2[0] === pt1[0]) {
			//计算直线方程的系数a，b
			// pt1,pt2 y轴相同
			return (pt3[0] - pt1[0]) * (pt4[0] - pt1[0]) < 0;
		}
		const a = (pt2[1] - pt1[1]) / (pt2[0] - pt1[0]);
		const b = (pt1[0] * pt2[1] - pt2[0] * pt1[1]) / (pt2[0] - pt1[0]);
		const fxy1 = pt3[1] - (a * pt3[0] - b);
		const fxy2 = pt4[1] - (a * pt4[0] - b);
		//当位于非同一侧时
		if ((fxy1 < 0 && fxy2 > 0) || (fxy1 > 0 && fxy2 < 0)) return true;
		//当位于同一侧时
		else return false;
	}
	/**
	 * 判断三角形是否逆时针
	 * @param {*} pt1
	 * @param {*} pt2
	 * @param {*} pt3
	 * @returns
	 */
	triangleCounterClockWise(pt1, pt2, pt3) {
		const vector12 = {
			x: pt2[0] - pt1[0],
			y: pt2[1] - pt1[1],
		};
		const vector13 = {
			x: pt3[0] - pt1[0],
			y: pt3[1] - pt1[1],
		};

		const cross = vector12.x * vector13.y - vector12.y * vector13.x;
		return cross > 0;
	}
	generateTin() {
		const me = this;
		let { index1, index2 } = this.getStartPoints();

		const p1 = this.points[index1];
		const p2 = this.points[index2];
		const middleX = (p1[0] + p2[0]) / 2;
		const middleY = (p1[1] + p2[1]) / 2;
		let index3 = this.getNearestPointIndex(middleX, middleY, [
			index1,
			index2,
		]);

		if (this.triangleCounterClockWise(p1, p2, this.points[index3])) {
			this.indices.push(index1, index2, index3);
		} else {
			this.indices.push(index1, index3, index2);
		}

		let trianglesExtended = 0;
		let trianglesFormed = 1;
		// console.log(trianglesFormed, index1, index2, index3);

		while (trianglesFormed !== trianglesExtended) {
			index1 = this.indices[trianglesExtended * 3];
			index2 = this.indices[trianglesExtended * 3 + 1];
			index3 = this.indices[trianglesExtended * 3 + 2];

			const formTriangle = (idx1, idx2, idx3) => {
				const pt1 = this.points[idx1];
				const pt2 = this.points[idx2];
				const pt3 = this.points[idx3];
	
				// idx1,idx2构成的边未被两个三角形共用
				if (me.edgeNotRepeatTwice(idx1, idx2, trianglesFormed)) {
					let minCos = Number.POSITIVE_INFINITY;
					let resultIndex = -1;

					for (let i = 0; i < this.pointCount; i += 1) {
						if (
							i !== index1 &&
							i !== index2 &&
							i !== index3 &&
							this.pointNotOnSameSide(
								pt1,
								pt2,
								pt3,
								this.points[i]
							)
						) {
							const cosValue = me.cos(pt1, pt2, me.points[i]);
							// 查找最大夹角
							if (cosValue < minCos) {
								minCos = cosValue;
								resultIndex = i;
							}
						}
					}

					if (resultIndex > -1) {
						if (
							me.triangleCounterClockWise(
								pt1,
								pt2,
								me.points[resultIndex]
							)
						) {
							me.indices.push(idx1, idx2, resultIndex);
						} else {
							me.indices.push(idx1, resultIndex, idx2);
						}
						trianglesFormed += 1;
						// console.log(trianglesFormed, idx1, idx2, resultIndex);
					}
				}
			};

			formTriangle(index1, index2, index3);

			formTriangle(index1, index3, index2);

			formTriangle(index2, index3, index1);

			trianglesExtended += 1;
		}

		return this.indices;
	}
}

export default Tin;
