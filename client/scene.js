import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        this.camera = new THREE.PerspectiveCamera(
            60, container.clientWidth / container.clientHeight, 0.1, 100
        );
        this.camera.position.set(12, 10, 12);
        this.camera.lookAt(5, 0, 4);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(5, 0, 4);

        this.walls = [];
        this.panels = [];
        this.wallMeshes = [];
        this.panelMeshes = [];
        this.sourceMesh = null;
        this.sourcePosition = [5, 4, 1.5];
        this.roomConfig = null;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.dragObject = null;
        this.dragOffset = new THREE.Vector3();
        this.isDragging = false;

        this._setupLights();
        this._setupGrid();
        this._setupEventListeners();

        this.onSourceMoved = null;
        this.onWallMoved = null;
        this.onPanelMoved = null;
    }

    _setupLights() {
        const ambient = new THREE.AmbientLight(0x404060, 0.8);
        this.scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 0.6);
        directional.position.set(10, 15, 10);
        directional.castShadow = true;
        this.scene.add(directional);

        const point = new THREE.PointLight(0x6688cc, 0.4, 30);
        point.position.set(5, 3, 4);
        this.scene.add(point);
    }

    _setupGrid() {
        const grid = new THREE.GridHelper(20, 20, 0x444466, 0x222244);
        grid.position.y = 0.01;
        this.scene.add(grid);
    }

    buildRoom(config) {
        this.roomConfig = config.scene;
        const { room_width, room_depth, room_height } = config.scene;

        while (this.wallMeshes.length > 0) {
            const m = this.wallMeshes.pop();
            this.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        }

        const wallMat = new THREE.MeshPhongMaterial({
            color: 0x556677,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });

        const floorGeo = new THREE.PlaneGeometry(room_width, room_depth);
        const floorMat = new THREE.MeshPhongMaterial({
            color: 0x333355,
            side: THREE.DoubleSide
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(room_width / 2, 0, room_depth / 2);
        floor.receiveShadow = true;
        this.scene.add(floor);
        this.wallMeshes.push(floor);

        const ceilingGeo = new THREE.PlaneGeometry(room_width, room_depth);
        const ceilingMat = new THREE.MeshPhongMaterial({
            color: 0x445566,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide
        });
        const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(room_width / 2, room_height, room_depth / 2);
        this.scene.add(ceiling);
        this.wallMeshes.push(ceiling);

        const makeWall = (w, h, pos, rotY) => {
            const geo = new THREE.PlaneGeometry(w, h);
            const mesh = new THREE.Mesh(geo, wallMat.clone());
            mesh.position.copy(pos);
            mesh.rotation.y = rotY;
            this.scene.add(mesh);
            this.wallMeshes.push(mesh);
        };

        makeWall(room_width, room_height,
            new THREE.Vector3(room_width / 2, room_height / 2, 0), 0);
        makeWall(room_width, room_height,
            new THREE.Vector3(room_width / 2, room_height / 2, room_depth), 0);
        makeWall(room_depth, room_height,
            new THREE.Vector3(0, room_height / 2, room_depth / 2), Math.PI / 2);
        makeWall(room_depth, room_height,
            new THREE.Vector3(room_width, room_height / 2, room_depth / 2), Math.PI / 2);

        this._createSource();
    }

    _createSource() {
        if (this.sourceMesh) {
            this.scene.remove(this.sourceMesh);
            this.sourceMesh.geometry.dispose();
            this.sourceMesh.material.dispose();
        }

        const geo = new THREE.SphereGeometry(0.2, 16, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: 0xff4444,
            emissive: 0xff2222,
            emissiveIntensity: 0.5
        });
        this.sourceMesh = new THREE.Mesh(geo, mat);
        this.sourceMesh.position.set(
            this.sourcePosition[0],
            this.sourcePosition[2],
            this.sourcePosition[1]
        );
        this.sourceMesh.userData.type = 'source';
        this.scene.add(this.sourceMesh);
    }

    addWall(start, end, height, material = 'concrete') {
        const s = new THREE.Vector3(start[0], height / 2, start[1]);
        const e = new THREE.Vector3(end[0], height / 2, end[1]);
        const length = s.distanceTo(e);
        const mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(e, s).normalize();
        const angle = Math.atan2(dir.z, dir.x);

        const color = material === 'concrete' ? 0x667788 : 0x886655;
        const geo = new THREE.BoxGeometry(length, height, 0.1);
        const mat = new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity: 0.7
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(mid);
        mesh.rotation.y = -angle;
        mesh.userData = { type: 'wall', index: this.wallMeshes.length };
        this.scene.add(mesh);
        this.wallMeshes.push(mesh);
        this.walls.push({ start, end, height, material });
        return this.walls.length - 1;
    }

    addPanel(position, width, height, orientation, material = 'acoustic_panel') {
        const color = 0x44aa66;
        const geo = new THREE.BoxGeometry(
            orientation === 'x' ? width : 0.08,
            height,
            orientation === 'z' ? width : 0.08
        );
        const mat = new THREE.MeshPhongMaterial({
            color,
            transparent: true,
            opacity: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(position[0], height / 2, position[1]);
        mesh.userData = { type: 'panel', index: this.panelMeshes.length };
        this.scene.add(mesh);
        this.panelMeshes.push(mesh);
        this.panels.push({ position, width, height, orientation, material });
        return this.panels.length - 1;
    }

    removePanel(index) {
        if (index >= 0 && index < this.panelMeshes.length) {
            const mesh = this.panelMeshes[index];
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            this.panelMeshes.splice(index, 1);
            this.panels.splice(index, 1);
            this.panelMeshes.forEach((m, i) => m.userData.index = i);
        }
    }

    _setupEventListeners() {
        const canvas = this.renderer.domElement;

        canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
        canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));

        window.addEventListener('resize', () => {
            this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        });
    }

    _getIntersected(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const draggables = [this.sourceMesh, ...this.panelMeshes].filter(Boolean);
        const intersects = this.raycaster.intersectObjects(draggables);
        return intersects.length > 0 ? intersects[0] : null;
    }

    _onPointerDown(event) {
        const hit = this._getIntersected(event);
        if (hit) {
            this.dragObject = hit.object;
            this.isDragging = true;
            this.controls.enabled = false;

            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.object.position.y);
            const intersection = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(plane, intersection);
            this.dragOffset.copy(hit.object.position).sub(intersection);
        }
    }

    _onPointerMove(event) {
        if (!this.isDragging || !this.dragObject) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.dragObject.position.y);
        const intersection = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersection);

        if (intersection) {
            const newPos = intersection.add(this.dragOffset);
            const w = this.roomConfig ? this.roomConfig.room_width : 10;
            const d = this.roomConfig ? this.roomConfig.room_depth : 8;
            newPos.x = Math.max(0.1, Math.min(w - 0.1, newPos.x));
            newPos.z = Math.max(0.1, Math.min(d - 0.1, newPos.z));
            this.dragObject.position.copy(newPos);

            if (this.dragObject.userData.type === 'source') {
                this.sourcePosition = [newPos.x, newPos.z, newPos.y];
                if (this.onSourceMoved) this.onSourceMoved(this.sourcePosition);
            } else if (this.dragObject.userData.type === 'panel') {
                const idx = this.dragObject.userData.index;
                this.panels[idx].position = [newPos.x, newPos.z];
                if (this.onPanelMoved) this.onPanelMoved(idx, [newPos.x, newPos.z]);
            }
        }
    }

    _onPointerUp() {
        this.isDragging = false;
        this.dragObject = null;
        this.controls.enabled = true;
    }

    clearVisualization() {
        const toRemove = [];
        this.scene.traverse(child => {
            if (child.userData.visualization) toRemove.push(child);
        });
        toRemove.forEach(child => {
            this.scene.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    update() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.update();
    }
}
