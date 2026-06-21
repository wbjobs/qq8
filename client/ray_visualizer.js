import * as THREE from 'three';

export class RayVisualizer {
    constructor(scene, config) {
        this.scene = scene;
        this.config = config;
        this.rayGroup = null;
        this.heatmapGroup = null;
        this.vizConfig = config.visualization;
    }

    _energyToColor(energy) {
        const high = this.vizConfig.ray_color_high;
        const low = this.vizConfig.ray_color_low;
        const t = Math.max(0, Math.min(1, energy));
        const r = low[0] + (high[0] - low[0]) * t;
        const g = low[1] + (high[1] - low[1]) * t;
        const b = low[2] + (high[2] - low[2]) * t;
        return new THREE.Color(r, g, b);
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
        if (this.rayGroup) {
            this.scene.remove(this.rayGroup);
            this.rayGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.rayGroup = null;
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
        this.clearRays();
        this.rayGroup = new THREE.Group();
        this.rayGroup.userData.visualization = true;

        const maxRays = Math.min(rays.length, 200);
        const step = Math.max(1, Math.floor(rays.length / maxRays));

        for (let i = 0; i < rays.length; i += step) {
            const ray = rays[i];
            const path = ray.path;
            const energies = ray.energies;

            if (path.length < 2) continue;

            const positions = [];
            const colors = [];

            for (let j = 0; j < path.length - 1; j++) {
                const p1 = path[j];
                const p2 = path[j + 1];

                positions.push(p1[0], p1[2], p1[1]);
                positions.push(p2[0], p2[2], p2[1]);

                const energy = energies[Math.min(j, energies.length - 1)];
                const color = this._energyToColor(energy);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

            const material = new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: this.vizConfig.ray_opacity,
                linewidth: 1
            });

            const lineSegments = new THREE.LineSegments(geometry, material);
            this.rayGroup.add(lineSegments);
        }

        this.scene.add(this.rayGroup);
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
}
