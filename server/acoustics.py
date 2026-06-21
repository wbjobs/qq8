import numpy as np
import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'shared', 'config.json')


def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


class AcousticsCalculator:
    def __init__(self, config=None):
        self.config = config or load_config()
        self.materials = self.config['materials']
        self.speed_of_sound = self.config['raytracer']['speed_of_sound']

    def get_absorption(self, material_name):
        mat = self.materials.get(material_name, self.materials['concrete'])
        return mat['absorption']

    def get_scattering(self, material_name):
        mat = self.materials.get(material_name, self.materials['concrete'])
        return mat['scattering']

    def reflection_coefficient(self, material_name):
        return 1.0 - self.get_absorption(material_name)

    def calculate_rt60_sabine(self, room_volume, total_absorption):
        if total_absorption <= 0:
            return float('inf')
        return 0.161 * room_volume / total_absorption

    def calculate_rt60_eyring(self, room_volume, total_absorption):
        if total_absorption <= 0:
            return float('inf')
        avg_abs = total_absorption / max(room_volume ** (1.0 / 3.0), 0.01)
        if avg_abs >= 1.0:
            return 0.0
        return 0.161 * room_volume / (-np.log(1.0 - min(avg_abs, 0.999)))

    def calculate_spl(self, source_power_db, distance, directivity=1.0):
        if distance <= 0:
            distance = 0.01
        spl = source_power_db + 10 * np.log10(directivity / (4 * np.pi * distance ** 2))
        return spl

    def calculate_total_absorption(self, surfaces):
        total = 0.0
        for surface in surfaces:
            area = surface.get('area', 0.0)
            material = surface.get('material', 'concrete')
            alpha = self.get_absorption(material)
            total += alpha * area
        return total

    def energy_to_spl(self, energy_ratio, reference_spl=100.0):
        if energy_ratio <= 0:
            return -np.inf
        return reference_spl + 10 * np.log10(energy_ratio)

    def spl_to_energy_ratio(self, spl, reference_spl=100.0):
        return 10 ** ((spl - reference_spl) / 10.0)

    def compute_heatmap(self, grid_points, rt60_values):
        if not rt60_values:
            return {}
        values = list(rt60_values.values())
        min_rt = min(values)
        max_rt = max(values)
        range_rt = max_rt - min_rt if max_rt > min_rt else 1.0
        heatmap = {}
        for key, rt60 in rt60_values.items():
            t = (rt60 - min_rt) / range_rt
            heatmap[key] = {
                'rt60': rt60,
                'normalized': t
            }
        return heatmap

    def energy_decay_at_distance(self, initial_energy, distance, air_absorption=None):
        if air_absorption is None:
            air_absorption = self.config['raytracer']['air_absorption']
        return initial_energy * np.exp(-air_absorption * distance)

    def compute_receiver_spl(self, source_power_db, direct_energy, reflected_energy_sum, distance):
        if direct_energy + reflected_energy_sum <= 0:
            return -np.inf
        total_energy = direct_energy + reflected_energy_sum
        return source_power_db + 10 * np.log10(total_energy / (4 * np.pi * max(distance, 0.01) ** 2))
