import numpy as np
import json
import os

try:
    from .acoustics import AcousticsCalculator
except ImportError:
    from acoustics import AcousticsCalculator

CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'shared', 'config.json')


def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


class Wall:
    def __init__(self, start, end, height, material='concrete'):
        self.start = np.array(start, dtype=np.float64)
        self.end = np.array(end, dtype=np.float64)
        self.height = float(height)
        self.material = material
        self.direction = self.end - self.start
        self.length = np.linalg.norm(self.direction)
        if self.length > 0:
            self.normal = np.array([-self.direction[1], self.direction[0], 0.0])
            self.normal = self.normal / np.linalg.norm(self.normal)
        else:
            self.normal = np.array([0.0, 1.0, 0.0])

    def to_dict(self):
        return {
            'start': self.start.tolist(),
            'end': self.end.tolist(),
            'height': self.height,
            'material': self.material,
            'normal': self.normal.tolist()
        }


class Room:
    def __init__(self, width, depth, height, wall_material='concrete'):
        self.width = width
        self.depth = depth
        self.height = height
        self.wall_material = wall_material
        self.walls = []
        self.panels = []
        self._build_room()

    def _build_room(self):
        w, d, h = self.width, self.depth, self.height
        self.walls = [
            Wall([0, 0], [w, 0], h, self.wall_material),
            Wall([w, 0], [w, d], h, self.wall_material),
            Wall([w, d], [0, d], h, self.wall_material),
            Wall([0, d], [0, 0], h, self.wall_material),
        ]

    def add_wall(self, start, end, height, material='concrete'):
        wall = Wall(start, end, height, material)
        self.walls.append(wall)
        return wall

    def add_panel(self, position, width, height, orientation, material='acoustic_panel'):
        x, y = position
        if orientation == 'x':
            start = [x - width / 2, y]
            end = [x + width / 2, y]
        else:
            start = [x, y - width / 2]
            end = [x, y + width / 2]
        panel = Wall(start, end, height, material)
        self.panels.append(panel)
        return panel

    def get_all_surfaces(self):
        return self.walls + self.panels

    def to_dict(self):
        return {
            'width': self.width,
            'depth': self.depth,
            'height': self.height,
            'walls': [w.to_dict() for w in self.walls],
            'panels': [p.to_dict() for p in self.panels]
        }


class RayTracer:
    def __init__(self, config=None):
        self.config = config or load_config()
        self.rt_config = self.config['raytracer']
        self.scene_config = self.config['scene']
        self.calculator = AcousticsCalculator(self.config)
        self.num_rays = self.rt_config['num_rays']
        self.max_reflections = self.rt_config['max_reflections']
        self.energy_threshold = self.rt_config['energy_threshold']
        self.air_absorption = self.rt_config['air_absorption']
        self.speed_of_sound = self.rt_config['speed_of_sound']

    def _ray_segment_intersection(self, ray_origin, ray_dir, wall):
        p = ray_origin[:2]
        d = ray_dir[:2]
        a = wall.start[:2]
        b = wall.end[:2]

        ab = b - a
        denom = d[0] * ab[1] - d[1] * ab[0]
        if abs(denom) < 1e-10:
            return None

        ap = p - a
        t = (ap[0] * ab[1] - ap[1] * ab[0]) / (-denom)
        s = (ap[0] * d[1] - ap[1] * d[0]) / (-denom)

        if t > 1e-4 and 0 <= s <= 1:
            hit_point_2d = p + t * d
            z = ray_origin[2] + t * ray_dir[2]
            if 0 <= z <= wall.height:
                hit_point = np.array([hit_point_2d[0], hit_point_2d[1], z])
                return t, hit_point, wall
        return None

    def _check_floor_ceiling(self, ray_origin, ray_dir):
        hits = []
        if abs(ray_dir[2]) > 1e-10:
            t_floor = -ray_origin[2] / ray_dir[2]
            if t_floor > 1e-4:
                p = ray_origin + t_floor * ray_dir
                if 0 <= p[0] <= self.scene_config['room_width'] and 0 <= p[1] <= self.scene_config['room_depth']:
                    hits.append((t_floor, p, 'floor'))

            t_ceil = (self.scene_config['room_height'] - ray_origin[2]) / ray_dir[2]
            if t_ceil > 1e-4:
                p = ray_origin + t_ceil * ray_dir
                if 0 <= p[0] <= self.scene_config['room_width'] and 0 <= p[1] <= self.scene_config['room_depth']:
                    hits.append((t_ceil, p, 'ceiling'))
        return hits

    def _find_closest_intersection(self, ray_origin, ray_dir, surfaces):
        closest = None
        min_t = float('inf')

        for surface in surfaces:
            result = self._ray_segment_intersection(ray_origin, ray_dir, surface)
            if result and result[0] < min_t:
                min_t = result[0]
                closest = (result[0], result[1], surface)

        fc_hits = self._check_floor_ceiling(ray_origin, ray_dir)
        for t, p, name in fc_hits:
            if t < min_t:
                min_t = t
                mat = 'carpet' if name == 'floor' else 'plaster'
                closest = (t, p, Wall([0, 0], [0, 0], 0, mat))

        return closest

    def _reflect(self, ray_dir, normal):
        return ray_dir - 2 * np.dot(ray_dir, normal) * normal

    def trace_ray(self, origin, direction, surfaces):
        ray_origin = np.array(origin, dtype=np.float64)
        ray_dir = np.array(direction, dtype=np.float64)
        ray_dir = ray_dir / np.linalg.norm(ray_dir)

        energy = 1.0
        path = [ray_origin.copy().tolist()]
        energies = [energy]
        total_distance = 0.0

        for _ in range(self.max_reflections):
            if energy < self.energy_threshold:
                break

            hit = self._find_closest_intersection(ray_origin, ray_dir, surfaces)
            if hit is None:
                break

            t, hit_point, surface = hit
            total_distance += t

            energy *= self.calculator.reflection_coefficient(surface.material)
            distance_3d = np.linalg.norm(hit_point - ray_origin)
            energy *= np.exp(-self.air_absorption * distance_3d)

            path.append(hit_point.copy().tolist())
            energies.append(energy)

            if hasattr(surface, 'normal'):
                normal = surface.normal
                if np.dot(ray_dir, normal) > 0:
                    normal = -normal
            else:
                if hit_point[2] < 0.01:
                    normal = np.array([0.0, 0.0, 1.0])
                else:
                    normal = np.array([0.0, 0.0, -1.0])

            ray_dir = self._reflect(ray_dir, normal)
            ray_dir = ray_dir / np.linalg.norm(ray_dir)
            ray_origin = hit_point.copy()

        return {
            'path': path,
            'energies': energies,
            'total_distance': total_distance
        }

    def _get_adaptive_ray_count(self, num_surfaces):
        base_rays = self.rt_config['num_rays']
        if num_surfaces <= 10:
            return base_rays
        elif num_surfaces <= 20:
            return max(200, int(base_rays * 0.7))
        else:
            return max(200, int(base_rays * 0.4))

    def generate_ray_directions(self, count=None):
        if count is None:
            count = self.num_rays
        directions = []
        golden_ratio = (1 + np.sqrt(5)) / 2
        for i in range(count):
            theta = 2 * np.pi * i / golden_ratio
            phi = np.arccos(1 - 2 * (i + 0.5) / count)
            x = np.sin(phi) * np.cos(theta)
            y = np.sin(phi) * np.sin(theta)
            z = np.cos(phi)
            directions.append([x, y, z])
        return directions

    def trace_all(self, source_position, room):
        surfaces = room.get_all_surfaces()
        adaptive_count = self._get_adaptive_ray_count(len(surfaces))
        directions = self.generate_ray_directions(adaptive_count)
        rays = []
        for d in directions:
            result = self.trace_ray(source_position, d, surfaces)
            rays.append(result)
        return rays, adaptive_count

    def calculate_rt60_at_points(self, source_position, room, grid_resolution=None):
        if grid_resolution is None:
            grid_resolution = self.scene_config['grid_resolution']

        w = room.width
        d = room.depth
        h = room.height
        room_volume = w * d * h

        surfaces_info = []
        for wall in room.walls:
            surfaces_info.append({
                'area': wall.length * wall.height,
                'material': wall.material
            })
        for panel in room.panels:
            surfaces_info.append({
                'area': panel.length * panel.height,
                'material': panel.material
            })
        surfaces_info.append({'area': w * d, 'material': 'carpet'})
        surfaces_info.append({'area': w * d, 'material': 'plaster'})

        total_absorption = self.calculator.calculate_total_absorption(surfaces_info)
        base_rt60 = self.calculator.calculate_rt60_sabine(room_volume, total_absorption)

        rt60_map = {}
        rays, _ = self.trace_all(source_position, room)

        x_points = np.arange(grid_resolution / 2, w, grid_resolution)
        y_points = np.arange(grid_resolution / 2, d, grid_resolution)

        for x in x_points:
            for y in y_points:
                receiver = np.array([x, y, 1.2])
                local_energy = 0.0
                for ray_data in rays:
                    path = ray_data['path']
                    energies = ray_data['energies']
                    for k in range(len(path) - 1):
                        seg_start = np.array(path[k])
                        seg_end = np.array(path[k + 1])
                        seg_dir = seg_end - seg_start
                        seg_len = np.linalg.norm(seg_dir)
                        if seg_len < 1e-6:
                            continue
                        seg_dir_n = seg_dir / seg_len
                        to_receiver = receiver - seg_start
                        proj = np.dot(to_receiver, seg_dir_n)
                        if proj < 0 or proj > seg_len:
                            continue
                        closest_point = seg_start + proj * seg_dir_n
                        dist = np.linalg.norm(receiver - closest_point)
                        influence_radius = 1.0
                        if dist < influence_radius:
                            weight = (1.0 - dist / influence_radius) ** 2
                            local_energy += energies[k] * weight

                if local_energy > 0:
                    total_ref = sum(e for es in [r['energies'] for r in rays] for e in es[1:])
                    ratio = local_energy / max(total_ref / len(rays), 1e-10)
                    rt60_local = base_rt60 * min(ratio, 3.0)
                else:
                    rt60_local = base_rt60 * 1.5

                key = f"{x:.1f},{y:.1f}"
                rt60_map[key] = round(rt60_local, 3)

        return rt60_map
