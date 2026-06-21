import * as THREE from 'three';

export class RayVisualizer {
    constructor(scene, config) {
        this.scene = scene;
        this.config = config;
        this.vizConfig = config.visualization;

        this.rayGroup = null;
        this.raySegments = null;
        this.rayGeometry = null;
        this.rayMaterial = null;
        this.positionAttr = null;
        this.colorAttr = null;

        this.heatmapGroup = null;

        this.MAX_SEGMENTS = 10000;
        this._createRayGeometry();
    }

    _createRayGeometry() {
        const maxVerts = this.MAX_SEGMENTS * 2;

        this.rayGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxVerts * 3);
        const colors = new Float32Array(maxVerts * 3);

        this.positionAttr = new THREE.BufferAttribute(positions, 3);
        this.colorAttr = new THREE.BufferAttribute(colors, 3);
        this.positionAttr.setUsage(THREE.DynamicDrawUsage);
        this.colorAttr.setUsage(THREE.DynamicDrawUsage);

        this.rayGeometry.setAttribute('position', this.positionAttr);
        this.rayGeometry.setAttribute('color', this.colorAttr);
        this.rayGeometry.setDrawRange(0, 0);

        this.rayMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: this.vizConfig.ray_opacity,
            linewidth: 1
        });

        this.raySegments = new THREE.LineSegments(this.rayGeometry, this.rayMaterial);
        this.raySegments.userData.visualization = true;
        this.raySegments.frustumCulled = false;

        this.rayGroup = new THREE.Group();
        this.rayGroup.userData.visualization = true;
        this.rayGroup.add(this.raySegments);
        this.scene.add(this.rayGroup);
    }

    _energyToColor(energy) {
        const high = this.vizConfig.ray_color_high;
        const low = this.vizConfig.ray_color_low;
        const t = Math.max(0, Math.min(1, energy));
        const r = low[0] + (high[0] - low[0]) * t;
        const g = low[1] + (high[1] - low[1]) * t;
        const b = low[2] + (high[2] - low[2]) * t;
        return { r, g, b };
    }

    _heatmapColor(normalized) {
        const t = Math.max(0, Math.min(1, normalized));
        const high = this.vizConfig.heatmap_high;
        const mid = this.vizConfig.heatmap_mid;
        const low = this.vizConfig.heatmap_low;

        let r, g, b;
        if (t < 0.5) {
            const s = t * 2;
            r = low[0] + (mid[0] - low[0]) * s;
            g = low[1] + (mid[1] - low[1]) * s;
            b = low[2] + (mid[2] - low[2]) * s;
        } else {
            const s = (t - 0.5) * 2;
            r = mid[0] + (high[0] - mid[0]) * s;
            g = mid[1] + (high[1] - mid[1]) * s;
            b = mid[2] + (high[2] - mid[2]) * s;
        }
        return new THREE.Color(r, g, b);
    }

    clearRays() {
        if (this.rayGeometry) {
            this.rayGeometry.setDrawRange(0, 0);
            this.positionAttr.needsUpdate = true;
            this.colorAttr.needsUpdate = true;
        }
    }

    clearHeatmap() {
        if (this.heatmapGroup) {
            this.scene.remove(this.heatmapGroup);
            this.heatmapGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.heatmapGroup = null;
        }
    }

    visualizeRays(rays) {
        if (!this.rayGeometry) {
            this._createRayGeometry();
        }

        const maxRays = Math.min(rays.length, 400);
        const step = Math.max(1, Math.floor(rays.length / maxRays));

        const positions = this.positionAttr.array;
        const colors = this.colorAttr.array;
        let vertexIdx = 0;
        let segmentCount = 0;

        for (let i = 0; i < rays.length; i += step) {
            const ray = rays[i];
            const path = ray.path;
            const energies = ray.energies;

            if (path.length < 2) continue;

            for (let j = 0; j < path.length - 1; j++) {
                if (segmentCount >= this.MAX_SEGMENTS) break;

                const p1 = path[j];
                const p2 = path[j + 1];

                const posIdx = vertexIdx * 3;
                positions[posIdx] = p1[0];
                positions[posIdx + 1] = p1[2];
                positions[posIdx + 2] = p1[1];
                positions[posIdx + 3] = p2[0];
                positions[posIdx + 4] = p2[2];
                positions[posIdx + 5] = p2[1];

                const energy = energies[Math.min(j, energies.length - 1)];
                const color = this._energyToColor(energy);
                colors[posIdx] = color.r;
                colors[posIdx + 1] = color.g;
                colors[posIdx + 2] = color.b;
                colors[posIdx + 3] = color.r;
                colors[posIdx + 4] = color.g;
                colors[posIdx + 5] = color.b;

                vertexIdx += 2;
                segmentCount++;
            }
        }

        this.rayGeometry.setDrawRange(0, segmentCount * 2);
        this.positionAttr.needsUpdate = true;
        this.colorAttr.needsUpdate = true;
        this.positionAttr.updateRange.count = segmentCount * 2 * 3;
        this.colorAttr.updateRange.count = segmentCount * 2 * 3;
    }

    visualizeHeatmap(heatmap, gridResolution = 1.0) {
        this.clearHeatmap();
        this.heatmapGroup = new THREE.Group();
        this.heatmapGroup.userData.visualization = true;

        const keys = Object.keys(heatmap);
        if (keys.length === 0) return;

        let minRT = Infinity, maxRT = -Infinity;
        for (const key of keys) {
            const rt = heatmap[key].rt60;
            if (rt < minRT) minRT = rt;
            if (rt > maxRT) maxRT = rt;
        }
        const range = maxRT - minRT || 1.0;

        const halfSize = gridResolution / 2 * 0.9;

        for (const key of keys) {
            const [x, y] = key.split(',').map(Number);
            const data = heatmap[key];
            const t = (data.rt60 - minRT) / range;
            const color = this._heatmapColor(t);

            const geo = new THREE.PlaneGeometry(halfSize * 2, halfSize * 2);
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.65,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(x, 0.02, y);
            mesh.userData.visualization = true;
            mesh.userData.rt60 = data.rt60;
            this.heatmapGroup.add(mesh);
        }

        this.scene.add(this.heatmapGroup);
    }

    addRayLegend() {
        this._removeLegend();

        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 20;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 200, 0);
        const low = this.vizConfig.ray_color_low;
        const high = this.vizConfig.ray_color_high;
        gradient.addColorStop(0, `rgb(${Math.round(low[0]*255)},${Math.round(low[1]*255)},${Math.round(low[2]*255)})`);
        gradient.addColorStop(1, `rgb(${Math.round(high[0]*255)},${Math.round(high[1]*255)},${Math.round(high[2]*255)})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 200, 20);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(4, 0.4, 1);
        sprite.position.set(-2, 4.5, -1);
        sprite.userData.visualization = true;
        sprite.userData.legend = true;
        this.scene.add(sprite);
    }

    _removeLegend() {
        const toRemove = [];
        this.scene.traverse(child => {
            if (child.userData.legend) toRemove.push(child);
        });
        toRemove.forEach(child => {
            this.scene.remove(child);
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
    }

    dispose() {
        this.clearRays();
        this.clearHeatmap();
        this._removeLegend();
        if (this.rayGroup) {
            this.scene.remove(this.rayGroup);
            this.rayGroup = null;
        }
        if (this.rayGeometry) {
            this.rayGeometry.dispose();
            this.rayGeometry = null;
        }
        if (this.rayMaterial) {
            this.rayMaterial.dispose();
            this.rayMaterial = null;
        }
        this.positionAttr = null;
        this.colorAttr = null;
    }
}
