import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from raytracer import RayTracer, Room
from acoustics import AcousticsCalculator

try:
    import websockets
except ImportError:
    websockets = None

from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading

CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'shared', 'config.json')


def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


class AcousticWebSocketServer:
    def __init__(self, config=None):
        self.config = config or load_config()
        self.raytracer = RayTracer(self.config)
        self.calculator = AcousticsCalculator(self.config)
        self.room = None
        self.source_position = None
        self.source_pattern = 'omnidirectional'
        self.source_forward_dir = [1, 0, 0]
        self._reset_room()

    def _reset_room(self):
        sc = self.config['scene']
        self.room = Room(
            sc['room_width'],
            sc['room_depth'],
            sc['room_height'],
            sc['default_wall_material']
        )
        self.source_position = [sc['room_width'] / 2, sc['room_depth'] / 2, 1.5]
        self.source_pattern = 'omnidirectional'
        self.source_forward_dir = [1, 0, 0]

    def _handle_message(self, message):
        try:
            data = json.loads(message)
            msg_type = data.get('type', '')

            if msg_type == 'add_wall':
                wall = self.room.add_wall(
                    data['start'], data['end'],
                    data.get('height', self.config['scene']['room_height']),
                    data.get('material', 'concrete')
                )
                return {'type': 'wall_added', 'wall': wall.to_dict()}

            elif msg_type == 'add_panel':
                panel = self.room.add_panel(
                    data['position'], data['width'],
                    data.get('height', 2.0),
                    data.get('orientation', 'x'),
                    data.get('material', 'acoustic_panel')
                )
                return {'type': 'panel_added', 'panel': panel.to_dict()}

            elif msg_type == 'move_wall':
                idx = data.get('index', 0)
                if idx < len(self.room.walls):
                    self.room.walls[idx].start = np.array(data['start'], dtype=np.float64)
                    self.room.walls[idx].end = np.array(data['end'], dtype=np.float64)
                    self.room.walls[idx].direction = self.room.walls[idx].end - self.room.walls[idx].start
                    self.room.walls[idx].length = np.linalg.norm(self.room.walls[idx].direction)
                    if self.room.walls[idx].length > 0:
                        self.room.walls[idx].normal = np.array([
                            -self.room.walls[idx].direction[1],
                            self.room.walls[idx].direction[0], 0.0
                        ])
                        self.room.walls[idx].normal /= np.linalg.norm(self.room.walls[idx].normal)
                    return {'type': 'wall_moved', 'index': idx}

            elif msg_type == 'remove_wall':
                idx = data.get('index', -1)
                extra = len(self.room.walls) - 4
                if 4 <= idx < len(self.room.walls) and extra > 0:
                    self.room.walls.pop(idx)
                    return {'type': 'wall_removed', 'index': idx}

            elif msg_type == 'remove_panel':
                idx = data.get('index', -1)
                if 0 <= idx < len(self.room.panels):
                    self.room.panels.pop(idx)
                    return {'type': 'panel_removed', 'index': idx}

            elif msg_type == 'set_source':
                self.source_position = data['position']
                return {'type': 'source_set', 'position': self.source_position}

            elif msg_type == 'set_source_pattern':
                self.source_pattern = data.get('pattern', 'omnidirectional')
                self.source_forward_dir = data.get('forward_dir', [1, 0, 0])
                return {
                    'type': 'source_pattern_set',
                    'pattern': self.source_pattern,
                    'forward_dir': self.source_forward_dir
                }

            elif msg_type == 'reset_scene':
                self._reset_room()
                return {'type': 'scene_reset'}

            elif msg_type == 'run_simulation':
                return self._run_simulation()

            elif msg_type == 'get_scene':
                return {
                    'type': 'scene_data',
                    'room': self.room.to_dict(),
                    'source': self.source_position,
                    'source_pattern': self.source_pattern,
                    'source_forward_dir': self.source_forward_dir
                }

            else:
                return {'type': 'error', 'message': f'Unknown message type: {msg_type}'}

        except Exception as e:
            return {'type': 'error', 'message': str(e)}

    def _run_simulation(self):
        import numpy as np
        import time
        start_time = time.time()
        rays, adaptive_count = self.raytracer.trace_all(
            self.source_position, self.room,
            pattern=self.source_pattern,
            forward_dir=self.source_forward_dir
        )

        ray_data = []
        for r in rays:
            if len(r['path']) < 2:
                continue
            energies = r.get('energy', r['energies'])
            ray_data.append({
                'path': r['path'],
                'energies': energies,
                'total_distance': round(r['total_distance'], 3)
            })

        rt60_map = self.raytracer.calculate_rt60_at_points(
            self.source_position, self.room,
            pattern=self.source_pattern,
            forward_dir=self.source_forward_dir
        )
        heatmap = self.calculator.compute_heatmap({}, rt60_map)

        room_volume = self.room.width * self.room.depth * self.room.height
        surfaces_info = []
        for wall in self.room.walls:
            surfaces_info.append({'area': wall.length * wall.height, 'material': wall.material})
        for panel in self.room.panels:
            surfaces_info.append({'area': panel.length * panel.height, 'material': panel.material})
        surfaces_info.append({'area': self.room.width * self.room.depth, 'material': 'carpet'})
        surfaces_info.append({'area': self.room.width * self.room.depth, 'material': 'plaster'})
        total_abs = self.calculator.calculate_total_absorption(surfaces_info)
        avg_rt60 = self.calculator.calculate_rt60_sabine(room_volume, total_abs)

        num_surfaces = len(self.room.walls) + len(self.room.panels)
        sim_time = round(time.time() - start_time, 3)

        return {
            'type': 'simulation_result',
            'rays': ray_data,
            'heatmap': heatmap,
            'average_rt60': round(avg_rt60, 3),
            'room_volume': round(room_volume, 2),
            'total_absorption': round(total_abs, 3),
            'adaptive_ray_count': adaptive_count,
            'num_surfaces': num_surfaces,
            'simulation_time': sim_time,
            'source_pattern': self.source_pattern,
            'source_forward_dir': self.source_forward_dir
        }

    async def _ws_handler(self, websocket):
        async for message in websocket:
            result = self._handle_message(message)
            if result:
                await websocket.send(json.dumps(result))

    async def _run_ws(self, host, port):
        if websockets is None:
            print("websockets library not installed. Run: pip install websockets")
            return
        async with websockets.serve(self._ws_handler, host, port):
            print(f"WebSocket server running on ws://{host}:{port}")
            await asyncio.Future()

    def run(self):
        host = self.config['server']['host']
        ws_port = self.config['server']['ws_port']

        project_root = os.path.join(os.path.dirname(__file__), '..')
        os.chdir(project_root)

        http_port = self.config['server']['http_port']

        class NoCacheHandler(SimpleHTTPRequestHandler):
            def end_headers(self):
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                super().end_headers()

            def log_message(self, format, *args):
                pass

        def start_http():
            handler = NoCacheHandler
            httpd = HTTPServer((host, http_port), handler)
            print(f"HTTP server running on http://{host}:{http_port}")
            httpd.serve_forever()

        http_thread = threading.Thread(target=start_http, daemon=True)
        http_thread.start()

        asyncio.run(self._run_ws(host, ws_port))


if __name__ == '__main__':
    import numpy as np
    server = AcousticWebSocketServer()
    server.run()
