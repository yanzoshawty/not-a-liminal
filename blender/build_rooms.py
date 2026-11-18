"""Procedurally build, light-bake and export the not-a-liminal rooms.

Run inside Blender 4.5 (Text editor or MCP):
    ROOM = 'backrooms'   # backrooms | pool | corridor | mall | entity | tall | silhouette | partygoer
    exec(open(r'<repo>/blender/build_rooms.py').read())

Each room lives in its own scene ("nal_build"), so the user's open file is untouched.
Blender axes: room starts at y=0 and runs toward +Y (exported as glTF -Z), floor at z=0.
Output per room: src/models/<room>.glb (TEXCOORD_0 = tiling albedo UV, TEXCOORD_1 = lightmap UV)
plus src/models/<room>_lm.webp (sRGB-encoded irradiance) and an entry in lightmaps.json.
"""
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(globals().get('__file__', r'C:\Users\yeet\OneDrive\Documents\yeet source project\not-a-liminal\blender\build_rooms.py')))
OUT = os.path.normpath(os.path.join(HERE, '..', 'src', 'models'))
LM = globals().get('LM_SIZE', 2048)
SAMPLES = globals().get('BAKE_SAMPLES', 256)
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- scene
def fresh_scene():
    sc = bpy.data.scenes.get('nal_build') or bpy.data.scenes.new('nal_build')
    bpy.context.window.scene = sc
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.lights, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    try:
        sc.render.engine = 'CYCLES'
    except TypeError as e:
        print(e)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
        sc.cycles.device = 'GPU'
    except TypeError:
        sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.render.bake.margin = 8
    if sc.world is None:
        sc.world = bpy.data.worlds.new('nal_world')
    sc.world.use_nodes = True
    return sc

def set_world(color, strength=1.0):
    bg = next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (*color, 1)
    bg.inputs[1].default_value = strength

# ---------------------------------------------------------------- textures (numpy, tileable)
def blur(a, n):
    for _ in range(n):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a

def noise(s, n=2):
    a = blur(rng.random((s, s)), n)
    return (a - a.min()) / (np.ptp(a) + 1e-6)

def lowfreq(s):
    small = rng.random((8, 8))
    a = np.kron(small, np.ones((s // 8, s // 8)))
    return (lambda b: (b - b.min()) / (np.ptp(b) + 1e-6))(blur(a, s // 6))

def grid(s, cells, width):
    t = (np.arange(s) * cells / s) % 1
    line = (t < width / 2) | (t > 1 - width / 2)
    return line[None, :] | line[:, None]

def make_image(name, rgb):
    s = rgb.shape[0]
    img = bpy.data.images.get(name) or bpy.data.images.new(name, s, s, alpha=False)
    px = np.ones((s, s, 4), np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img

def tint(c, f):
    return np.asarray(c)[None, None, :] * f[..., None]

TEX = {
    'wallpaper': lambda s=512: (lambda x, y: tint((0.80, 0.71, 0.40),
        (0.96 + 0.04 * np.cos(x * 2 * np.pi * 8 / s))
        * np.where((np.abs((x / 32) % 1 - 0.5) + np.abs((y / 32) % 1 - 0.5)) < 0.12, 0.93, 1.0)
        * (0.94 + 0.08 * noise(s, 1)) * (0.86 + 0.14 * lowfreq(s))))(*np.meshgrid(np.arange(s), np.arange(s))),
    'carpet': lambda s=256: tint((0.55, 0.47, 0.25), (0.82 + 0.3 * noise(s, 1)) * (0.85 + 0.15 * lowfreq(s))),
    'ceiling': lambda s=256: tint((0.86, 0.84, 0.76), np.where(grid(s, 2, 0.03), 0.62, 0.95 + 0.05 * noise(s, 0))),
    'tile_white': lambda s=256: tint((0.93, 0.94, 0.93), np.where(grid(s, 6, 0.06), 0.72, 0.97 + 0.03 * noise(s, 3))),
    'tile_cyan': lambda s=256: tint((0.52, 0.80, 0.84), np.where(grid(s, 6, 0.06), 0.78, 0.97 + 0.03 * noise(s, 3))),
    'linoleum': lambda s=256: (lambda c: np.where(c[..., None], np.array([0.60, 0.62, 0.56]), np.array([0.44, 0.48, 0.43]))
        * (0.93 + 0.1 * noise(s, 1))[..., None])((np.arange(s)[None, :] * 2 // s + np.arange(s)[:, None] * 2 // s) % 2 == 0),
    'wainscot': lambda s=256: (lambda v: np.where((v > 0.37) & (v < 0.39), 0.15,
        np.where(v < 0.37, 1, 0))[..., None] * 0 + np.where((v < 0.37)[..., None], np.array([0.22, 0.33, 0.27]),
        np.where(((v > 0.37) & (v < 0.395))[..., None], np.array([0.12, 0.16, 0.13]), np.array([0.85, 0.82, 0.72])))
        * (0.93 + 0.1 * noise(s, 1))[..., None])(np.repeat(np.arange(s)[:, None] / s, s, 1)),
    'locker': lambda s=256: (lambda u, v: tint((0.36, 0.43, 0.52),
        np.where((u % 1 < 0.02), 0.5, 1) * np.where((v > 0.78) & (v < 0.9) & ((v * 60) % 1 < 0.45) & (u % 1 > 0.25) & (u % 1 < 0.75), 0.45, 1)
        * (0.94 + 0.06 * noise(s, 2))))(*np.meshgrid(np.arange(s) / s, np.arange(s) / s)),
    'shutter': lambda s=256: tint((0.52, 0.53, 0.52), (0.82 + 0.18 * np.cos(np.arange(s)[:, None] / s * 2 * np.pi * 24)) * (0.9 + 0.1 * noise(s, 2))),
    'mallfloor': lambda s=256: tint((0.74, 0.70, 0.63), np.where(grid(s, 1, 0.02), 0.6, 0.9 + 0.1 * noise(s, 4))),
    'wood': lambda s=256: tint((0.40, 0.25, 0.14), 0.85 + 0.2 * blur(rng.random((s, s)), 1).repeat(1, 0)[:, :1].repeat(s, 1).T),
    # yellow face, two black eyes, very wide open grin (pixel row 0 = bottom, so v points up)
    'partyface': lambda s=256: (lambda u, v: tint((1.0, 0.84, 0.08), np.where(
        ((u - 0.35) ** 2 + (v - 0.63) ** 2 < 0.055 ** 2) | ((u - 0.65) ** 2 + (v - 0.63) ** 2 < 0.055 ** 2)
        | ((((u - 0.5) / 0.4) ** 2 + ((v - 0.46) / 0.24) ** 2 < 1) & (v < 0.46 + 0.05 * ((u - 0.5) / 0.4) ** 2)), 0.02, 1.0)))(
        *np.meshgrid(np.arange(s) / s, np.arange(s) / s)),
}

# ---------------------------------------------------------------- materials
def material(name, color=(0.8, 0.8, 0.8), tex=None, emit=None, strength=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    if tex:
        it = nt.nodes.new('ShaderNodeTexImage')
        it.image = make_image('t_' + tex, TEX[tex]())
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'uv'
        nt.links.new(uv.outputs[0], it.inputs[0])
        nt.links.new(it.outputs[0], bsdf.inputs['Base Color'])
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return m

# ---------------------------------------------------------------- geometry builder
class Part:
    def __init__(self):
        self.bm = bmesh.new()

    def box(self, a, b):
        (x0, y0, z0), (x1, y1, z1) = a, b
        v = [self.bm.verts.new(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
        for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            self.bm.faces.new([v[i] for i in f])
        return self

    def quad(self, *pts):
        self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        return self

    def floor(self, x0, y0, x1, y1, z=0.0):
        return self.quad((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))

    def ceiling(self, x0, y0, x1, y1, z):
        return self.quad((x0, y0, z), (x0, y1, z), (x1, y1, z), (x1, y0, z))

    def slab(self, base, run, width, rise, thick):
        """Inclined slab (escalator): base=(x,y,z) bottom-centre, runs toward +Y."""
        x, y, z = base
        a = [(x - width / 2, y, z), (x + width / 2, y, z), (x + width / 2, y + run, z + rise), (x - width / 2, y + run, z + rise)]
        b = [(p[0], p[1], p[2] - thick) for p in a]
        v = [self.bm.verts.new(p) for p in a + b]
        for f in [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
            self.bm.faces.new([v[i] for i in f])
        return self

    def cylinder(self, cx, cy, z0, r, h, segs=32):
        ret = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=h)
        for vv in ret['verts']:
            vv.co.x += cx; vv.co.y += cy; vv.co.z += z0 + h / 2
        return self

    def sphere(self, cx, cy, cz, r, sx=1, sy=1, sz=1):
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=16, v_segments=10, radius=r)
        for vv in ret['verts']:
            vv.co.x = vv.co.x * sx + cx; vv.co.y = vv.co.y * sy + cy; vv.co.z = vv.co.z * sz + cz
        return self

    def seg(self, a, b, r1, r2=None, segs=8):
        """Tapered cylinder from point a (radius r1) to point b (radius r2)."""
        a, b = Vector(a), Vector(b)
        d = b - a
        M = Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=r1, radius2=r1 if r2 is None else r2,
                              depth=d.length, matrix=M)
        return self

    def torus(self, R, r, cz=0.0, segs=16, rsegs=8):
        """Flat ring around the Z axis, centred at height cz."""
        v = [[self.bm.verts.new(((R + r * math.cos(p)) * math.cos(t), (R + r * math.cos(p)) * math.sin(t), cz + r * math.sin(p)))
              for p in (2 * math.pi * j / rsegs for j in range(rsegs))] for t in (2 * math.pi * i / segs for i in range(segs))]
        for i in range(segs):
            for j in range(rsegs):
                i1, j1 = (i + 1) % segs, (j + 1) % rsegs
                self.bm.faces.new((v[i][j], v[i1][j], v[i1][j1], v[i][j1]))
        return self

    def text(self, s, width, M):
        """Blender text object -> mesh, scaled to `width`, laid on local XY (normal +Z), then transformed by M."""
        cu = bpy.data.curves.new('txt', type='FONT')
        cu.body, cu.align_x, cu.align_y, cu.resolution_u = s, 'CENTER', 'CENTER', 3
        ob = bpy.data.objects.new('txt', cu)
        bpy.context.scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        tmp = bmesh.new(); tmp.from_mesh(me)
        xs = [v.co.x for v in tmp.verts]
        k = width / (max(xs) - min(xs))
        M = M @ Matrix.Scale(k, 4)
        vm = {v: self.bm.verts.new(M @ v.co) for v in tmp.verts}
        for f in tmp.faces:
            self.bm.faces.new([vm[v] for v in f.verts])
        tmp.free()
        bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
        return self

    def build(self, name, mat, tile=(1.0, 1.0), **props):
        bm = self.bm  # winding is authored outward/inward by hand; recalc would flip lone quads
        bm.normal_update()
        uv = bm.loops.layers.uv.new('uv')
        tu, tv = tile
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                l[uv].uv = (c.x / tu, c.y / tv) if ax == 2 else ((c.y / tu, c.z / tv) if ax == 0 else (c.x / tu, c.z / tv))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        for k, v in props.items():
            ob[k] = v
        return ob

def area_light(x, y, z, sx, sy, power, color=(1.0, 0.95, 0.82)):
    ld = bpy.data.lights.new('a', 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = sx, sy
    ld.energy = power
    ld.color = color
    ob = bpy.data.objects.new('L', ld)
    ob.location = (x, y, z)
    bpy.context.scene.collection.objects.link(ob)  # default area light points down (-Z)

def point_light(x, y, z, power, color):
    ld = bpy.data.lights.new('p', 'POINT')
    ld.energy, ld.color, ld.shadow_soft_size = power, color, 0.1
    ob = bpy.data.objects.new('P', ld)
    ob.location = (x, y, z)
    bpy.context.scene.collection.objects.link(ob)

def spot(i, x, y, z=0.0):
    e = bpy.data.objects.new(f'spot_{i}', None)
    e.location = (x, y, z)
    bpy.context.scene.collection.objects.link(e)

def wall(p, x0, y0, x1, y1, h, t=0.2):
    if x0 == x1:
        p.box((x0 - t / 2, y0, 0), (x0 + t / 2, y1, h))
    else:
        p.box((x0, y0 - t / 2, 0), (x1, y0 + t / 2, h))

def end_wall(p, y, x0, x1, h, gap=1.2, door_h=2.2, t=0.2):
    p.box((x0, y - t / 2, 0), (-gap, y + t / 2, h))
    p.box((gap, y - t / 2, 0), (x1, y + t / 2, h))
    p.box((-gap, y - t / 2, door_h), (gap, y + t / 2, h))

NEON = lambda: material('neon', (1, 1, 1), emit=(1.0, 0.96, 0.82), strength=12)
NEON_OFF = lambda: material('neon_off', (0.55, 0.55, 0.5))

def empty(name, x, y, z=0.0):
    e = bpy.data.objects.new(name, None)
    e.location = (x, y, z)
    bpy.context.scene.collection.objects.link(e)

# ---------------------------------------------------------------- props
PMAT = {
    'dark': lambda: material('p_dark', (0.06, 0.06, 0.065)),
    'white': lambda: material('p_white', (0.85, 0.85, 0.82)),
    'blue': lambda: material('p_blue', (0.30, 0.50, 0.78)),
    'red': lambda: material('p_red', (0.72, 0.10, 0.08)),
    'yellow': lambda: material('p_yellow', (0.92, 0.72, 0.08)),
    'green': lambda: material('p_green', (0.16, 0.34, 0.14)),
    'cardboard': lambda: material('p_cardboard', (0.55, 0.40, 0.24)),
    'metal': lambda: material('p_metal', (0.45, 0.47, 0.48)),
    'towel': lambda: material('p_towel', (0.82, 0.36, 0.30)),
    'tarp': lambda: material('p_tarp', (0.15, 0.20, 0.32)),
    'cork': lambda: material('p_cork', (0.60, 0.45, 0.30)),
    'wood': lambda: material('wood', tex='wood'),
    'chrome': lambda: material('chrome', (0.75, 0.77, 0.78)),
}

class Props:
    """Parts keyed by material. Shapes are authored at the origin, front facing -Y, and placed with put().
    one=True routes every material into a single Part (a glitch item must be one mesh)."""
    def __init__(self, one=False):
        self.parts, self.one = {}, one

    def __getitem__(self, k):
        k = '_' if self.one else k
        if k not in self.parts:
            self.parts[k] = Part()
        return self.parts[k]

    def put(self, fn, x=0.0, y=0.0, z=0.0, a=0.0, tilt=(0.0, 0.0), **kw):
        old = {k: set(p.bm.verts) for k, p in self.parts.items()}  # not an index: bmesh ops reuse freed slots
        fn(self, **kw)
        M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Y')
        for k, p in self.parts.items():
            for v in p.bm.verts:
                if v not in old.get(k, ()):
                    v.co = M @ v.co
        return self

    def build(self, prefix):
        for k, p in self.parts.items():
            p.build(f'{prefix}_{k}', PMAT[k](), (0.9, 0.9) if k == 'wood' else (1.0, 1.0))

def glitch(tag, mat, fn, x, y, z=0.0, a=0.0, tilt=(0.0, 0.0), **kw):
    g = Props(one=True).put(fn, x, y, z, a, tilt, **kw)
    g['_'].build('glitch_' + tag, PMAT[mat](), glitch=tag, hotspot='glitch_' + tag)

R90 = math.pi / 2

def office_chair(P):
    d = P['dark']
    d.box((-0.3, -0.03, 0), (0.3, 0.03, 0.05)).box((-0.03, -0.3, 0), (0.03, 0.3, 0.05))
    d.cylinder(0, 0, 0.05, 0.03, 0.38, 8)
    d.box((-0.25, -0.25, 0.43), (0.25, 0.25, 0.5)).box((-0.22, 0.2, 0.56), (0.22, 0.26, 1.0)).box((-0.03, 0.2, 0.48), (0.03, 0.25, 0.58))

def water_cooler(P):
    P['white'].box((-0.17, -0.17, 0), (0.17, 0.17, 0.95))
    P['blue'].cylinder(0, 0, 0.95, 0.14, 0.42, 12)
    P['dark'].box((-0.07, -0.19, 0.7), (0.07, -0.17, 0.78))

def carton(P, w=0.5, d=0.4, h=0.4):
    P['cardboard'].box((-w / 2, -d / 2, 0), (w / 2, d / 2, h))

def bucket(P, col='blue'):
    P[col].seg((0, 0, 0), (0, 0, 0.3), 0.12, 0.15, 12)
    P['metal'].torus(0.15, 0.006, 0.3, 12, 4)

def filing_cabinet(P):
    P['metal'].box((-0.24, -0.3, 0), (0.24, 0.3, 1.32))
    for z in (0.28, 0.6, 0.92, 1.22):
        P['dark'].box((-0.08, -0.32, z), (0.08, -0.3, z + 0.03))

def cable_reel(P):
    w = P['wood']
    w.cylinder(0, 0, 0, 0.35, 0.04, 12).cylinder(0, 0, 0.04, 0.15, 0.3, 10).cylinder(0, 0, 0.34, 0.35, 0.04, 12)
    P['dark'].cylinder(0, 0, 0.06, 0.27, 0.26, 12).box((0.25, -0.02, 0), (1.3, 0.02, 0.025))

def wet_sign(P):
    P.put(lambda Q: Q['yellow'].box((-0.16, -0.01, 0), (0.16, 0.01, 0.64)), 0, -0.11, 0, tilt=(-0.17, 0))
    P.put(lambda Q: Q['yellow'].box((-0.16, -0.01, 0), (0.16, 0.01, 0.64)), 0, 0.11, 0, tilt=(0.17, 0))
    P.put(lambda Q: Q['dark'].box((-0.1, -0.012, 0.3), (0.1, -0.01, 0.42)), 0, -0.11, 0, tilt=(-0.17, 0))

def trash_can(P, r=0.18, h=0.6, col='metal'):
    P[col].cylinder(0, 0, 0, r, h, 12)
    P['dark'].cylinder(0, 0, h, r * 0.85, 0.015, 12)

def folding_chair(P):
    P['white'].box((-0.21, -0.2, 0.43), (0.21, 0.2, 0.46)).box((-0.21, 0.17, 0.62), (0.21, 0.2, 0.86))
    for s in (-1, 1):
        P['chrome'].seg((s * 0.2, -0.18, 0), (s * 0.2, 0.19, 0.86), 0.012, None, 6).seg((s * 0.2, 0.2, 0), (s * 0.2, -0.15, 0.45), 0.012, None, 6)

def lifebuoy(P):
    P['red'].torus(0.3, 0.07, 0.07)

def lifebuoy_wall(P):
    P.put(lifebuoy, tilt=(R90, 0))

def lifeguard_chair(P):
    w = P['wood']
    for sx in (-1, 1):
        for sy in (-1, 1):
            w.seg((sx * 0.42, sy * 0.42, 0), (sx * 0.28, sy * 0.28, 1.8), 0.03, None, 6)
        w.box((sx * 0.3 - 0.02, -0.3, 1.86), (sx * 0.3 + 0.02, 0.3, 2.1))
    for z in (0.4, 0.8, 1.2, 1.6):
        w.box((-0.38, -0.39, z), (0.38, -0.35, z + 0.04))
    w.box((-0.32, -0.32, 1.8), (0.32, 0.32, 1.86)).box((-0.32, 0.26, 1.86), (0.32, 0.32, 2.45))

def towel(P):
    P['towel'].box((-0.35, -0.6, 0), (0.35, 0.6, 0.02))

def kickboard(P):
    P['blue'].box((-0.22, -0.3, 0), (0.22, 0.3, 0.04))

def text_sign(P, text, w, h):
    """Wall sign centred on the origin, back at y=0.03, front face y=0."""
    P['white'].box((-w / 2, 0, -h / 2), (w / 2, 0.03, h / 2))
    P['red'].box((-w / 2, -0.004, h / 2 - 0.06), (w / 2, 0, h / 2)).box((-w / 2, -0.004, -h / 2), (w / 2, 0, -h / 2 + 0.06))
    P['dark'].text(text, w * 0.86, Matrix.Translation((0, -0.006, 0)) @ Matrix.Rotation(R90, 4, 'X'))

def notice_board(P):
    P['wood'].box((-0.8, 0, -0.05), (0.8, 0.03, 0.85))
    P['cork'].box((-0.74, -0.015, 0), (0.74, 0, 0.8))
    for (x, z, w, h) in [(-0.55, 0.45, 0.2, 0.28), (-0.2, 0.5, 0.21, 0.28), (0.2, 0.15, 0.3, 0.4), (0.5, 0.5, 0.18, 0.24), (-0.45, 0.08, 0.22, 0.3)]:
        P['white'].box((x - w / 2, -0.02, z), (x + w / 2, -0.015, z + h))

def extinguisher(P):
    P['red'].cylinder(0, 0, 0, 0.08, 0.48, 10)
    P['dark'].cylinder(0, 0, 0.48, 0.025, 0.08, 6).seg((0, -0.03, 0.54), (0.07, -0.06, 0.2), 0.012, None, 5)
    P['metal'].box((-0.03, 0.07, 0.15), (0.03, 0.1, 0.4))

def wall_clock(P):
    P['dark'].seg((0, 0, 0), (0, -0.04, 0), 0.175, None, 16)
    P['white'].seg((0, -0.04, 0), (0, -0.045, 0), 0.15, None, 16)
    P['dark'].box((-0.005, -0.05, -0.01), (0.005, -0.045, 0.1)).box((-0.09, -0.05, -0.005), (0.01, -0.045, 0.005))

def drinking_fountain(P):
    P['metal'].box((-0.25, -0.33, 0.75), (0.25, 0, 0.95)).box((-0.08, -0.12, 0), (0.08, 0, 0.75))
    P['chrome'].box((-0.02, -0.2, 0.95), (0.02, -0.16, 1.0))

def bench_seat(P):
    P['wood'].box((-1, -0.2, 0.43), (1, 0.2, 0.47))
    for dx in (-0.85, 0.85):
        P['metal'].box((dx - 0.04, -0.18, 0), (dx + 0.04, 0.18, 0.43))

def mop_bucket(P):
    P['yellow'].box((-0.2, -0.15, 0.05), (0.2, 0.15, 0.35))
    P['dark'].box((-0.18, -0.13, 0), (0.18, 0.13, 0.05))
    P['wood'].seg((0.05, 0, 0.1), (0.15, 0.25, 1.3), 0.015, None, 6)
    P['white'].box((-0.02, -0.06, 0.1), (0.12, 0.08, 0.3))

def poster(P, w=0.6, h=0.8):
    P['white'].box((-w / 2, -0.015, 0), (w / 2, 0, h))

def plant(P, s=1.0):
    P['dark'].cylinder(0, 0, 0, 0.22 * s, 0.4 * s, 10)
    P['green'].sphere(0, 0, 0.68 * s, 0.3 * s).sphere(0.1 * s, 0.05 * s, 0.98 * s, 0.22 * s).sphere(-0.08 * s, -0.06 * s, 1.18 * s, 0.17 * s)

def trolley(P):
    c = P['chrome']
    c.box((-0.28, -0.45, 0.45), (0.28, 0.45, 0.47))
    c.box((-0.29, -0.45, 0.45), (-0.27, 0.45, 0.85)).box((0.27, -0.45, 0.45), (0.29, 0.45, 0.85))
    c.box((-0.28, -0.47, 0.45), (0.28, -0.45, 0.85)).box((-0.28, 0.45, 0.45), (0.28, 0.47, 0.85))
    c.seg((-0.3, 0.56, 1.0), (0.3, 0.56, 1.0), 0.015, None, 6)
    for s in (-1, 1):
        c.seg((s * 0.28, 0.46, 0.85), (s * 0.28, 0.56, 1.0), 0.012, None, 6)
        for sy in (-1, 1):
            c.seg((s * 0.25, sy * 0.4, 0.08), (s * 0.25, sy * 0.4, 0.45), 0.012, None, 6)
            P['dark'].box((s * 0.25 - 0.02, sy * 0.4 - 0.04, 0), (s * 0.25 + 0.02, sy * 0.4 + 0.04, 0.08))

def mannequin(P):
    w = P['white']
    for s in (-1, 1):
        w.seg((s * 0.09, 0, 0.06), (s * 0.1, 0, 0.92), 0.05, 0.065, 8)
        w.seg((s * 0.2, 0, 1.43), (s * 0.24, -0.03, 0.86), 0.045, 0.035, 8)
    w.sphere(0, 0, 0.95, 0.15, 1.1, 0.75, 0.7)
    w.seg((0, 0, 0.95), (0, 0, 1.45), 0.13, 0.17, 10).seg((0, 0, 1.45), (0, 0, 1.58), 0.045, None, 6)
    w.sphere(0, 0, 1.69, 0.11, 0.85, 0.95, 1.2)
    P['dark'].cylinder(0, 0, 0, 0.2, 0.03, 12).seg((0, 0.06, 0.03), (0, 0.06, 0.55), 0.015, None, 6)

def kiosk_cart(P):
    P['wood'].box((-1, -0.6, 0.25), (1, 0.6, 1.0))
    P['tarp'].box((-1.06, -0.66, 0.6), (1.06, 0.66, 1.62))
    for sx in (-0.7, 0.7):
        P['dark'].seg((sx, -0.64, 0.2), (sx, -0.56, 0.2), 0.2, None, 10).seg((sx, 0.56, 0.2), (sx, 0.64, 0.2), 0.2, None, 10)

def directory_board(P):
    P['metal'].box((-0.6, -0.08, 0), (0.6, 0.08, 2.1))
    P['white'].box((-0.5, -0.09, 0.6), (0.5, -0.08, 1.95))
    for (x, z, w, h, c) in [(-0.3, 1.5, 0.3, 0.3, 'blue'), (0.1, 1.55, 0.45, 0.25, 'red'), (-0.25, 1.0, 0.35, 0.35, 'yellow'),
                            (0.2, 0.95, 0.3, 0.4, 'blue'), (0, 0.7, 0.8, 0.12, 'dark')]:
        P[c].box((x - w / 2, -0.095, z), (x + w / 2, -0.09, z + h))

def vending(P):
    P['red'].box((-0.45, -0.4, 0), (0.45, 0.4, 1.9))

def ball(P, r=0.25):
    P['white'].sphere(0, 0, r, r)

def crate(P, w=0.6, d=0.8, h=0.9, col='blue'):
    P[col].box((-w / 2, -d / 2, 0), (w / 2, d / 2, h))

# ---------------------------------------------------------------- rooms
def backrooms():
    H, W, L = 2.7, 9.0, 32.0
    set_world((0.02, 0.018, 0.01), 0.3)
    Part().floor(-W, 0, W, L).build('floor', material('carpet', tex='carpet'), (1.5, 1.5))
    Part().ceiling(-W, 0, W, L, H).build('ceiling', material('ceiling', tex='ceiling'), (1.2, 1.2))
    p = Part()
    wall(p, -W, 0, -W, L, H); wall(p, W, 0, W, L, H)
    wall(p, -W, 0, W, 0, H); wall(p, -W, L, W, L, H)  # solid: the camera noclips through
    for s in [(-1.6, 3, -1.6, 9), (1.6, 4, 1.6, 7), (-1.6, 12, -1.6, 14), (-1.6, 17, -1.6, 23), (1.6, 19, 1.6, 25),
              (-1.6, 26, -1.6, 30), (1.6, 28, 1.6, 31), (-9, 8, -4, 8), (-6, 14, -1.6, 14), (4, 6, 9, 6),
              (1.6, 12, 6, 12), (-9, 20, -5, 20), (5, 22, 9, 22), (-4, 26, -1.6, 26), (3, 28, 7, 28)]:
        wall(p, *s, H)
    for (x, y) in [(-5, 4), (5, 16), (-4, 17), (6, 26)]:
        p.box((x - 0.3, y - 0.3, 0), (x + 0.3, y + 0.3, H))
    wp = material('wallpaper', tex='wallpaper')
    p.build('walls', wp, (0.6, H))
    Part().box((1.5, 10, 0), (1.7, 16, H)).build('hs_wallpaper', wp, (0.6, H), hotspot='wallpaper')
    Part().floor(0.0, 12.4, 1.4, 13.6, 0.004).build('hs_carpet', material('carpet_stain', (0.32, 0.26, 0.12), tex=None), hotspot='carpet')
    on, off, lamp = Part(), Part(), Part()
    broken = {(3, 11), (-6, 20), (6, 29), (0, 26)}
    for x in (-6, -3, 0, 3, 6):
        for y in range(2, 31, 3):
            panel = (x - 0.3, y - 0.6, x + 0.3, y + 0.6)
            if (x, y) == (0, 8):
                lamp.ceiling(*panel, H - 0.01)
            elif (x, y) in broken:
                off.ceiling(*panel, H - 0.01); continue
            else:
                on.ceiling(*panel, H - 0.01)
            area_light(x, y, H - 0.02, 0.6, 1.2, 45)
    on.build('neon', NEON(), neon=1)
    off.build('neon_dead', NEON_OFF())
    lamp.build('hs_lamp', NEON(), hotspot='lamp', neon=1)
    for i, (x, y) in enumerate([(-5, 11), (5, 18), (-7, 24), (4, 30), (0.5, 31)]):
        spot(i, x, y)
    # props sit outside the x=±1.6 channel, visible through its openings (right 7-10/16-19/25-28, left 9-12/14-17/23-26)
    P = Props()
    P.put(wet_sign, 2.0, 1.8, a=0.4)
    P.put(office_chair, 2.7, 7.8, a=2.4)
    P.put(filing_cabinet, 2.0, 10.45, a=R90)
    P.put(office_chair, 3.0, 17.0, a=-0.6)
    P.put(water_cooler, 2.2, 18.5)
    P.put(carton, -2.6, 14.8, a=0.2)
    P.put(carton, -3.2, 15.4, a=-0.3, w=0.6, d=0.45, h=0.45)
    P.put(carton, -2.65, 14.85, 0.4, a=0.5, w=0.4, d=0.35, h=0.3)
    P.put(bucket, -2.3, 23.7)
    P.put(cable_reel, -3.2, 25.1, a=0.3)
    P.build('props')
    glitch('clip', 'dark', office_chair, -2.9, 10.6, -0.28, a=0.8, tilt=(0.35, 0.2))     # sunk into the carpet
    glitch('float', 'cardboard', carton, 3.1, 9.0, 0.42, a=0.6, tilt=(0.25, 0.15))
    glitch('double', 'metal', trash_can, 2.4, 26.6)
    glitch('missing', 'white', poster, -1.499, 27.6, 1.15, a=R90, w=0.7, h=0.9)          # on the channel wall

def pool():
    H, W, L, D = 6.0, 8.0, 32.0, 1.6
    bx0, bx1, by0, by1 = -4.5, 4.5, 5.0, 27.0
    set_world((0.05, 0.07, 0.09), 0.6)
    white, cyan = material('tile_white', tex='tile_white'), material('tile_cyan', tex='tile_cyan')
    f = Part()
    f.floor(-W, 0, W, by0).floor(-W, by1, W, L).floor(-W, by0, bx0, by1).floor(bx1, by0, W, by1)
    f.build('floor', white, (1, 1))
    b = Part().floor(bx0, by0, bx1, by1, -D)
    b.quad((bx0, by0, -D), (bx0, by1, -D), (bx0, by1, 0), (bx0, by0, 0))
    b.quad((bx1, by0, -D), (bx1, by0, 0), (bx1, by1, 0), (bx1, by1, -D))
    b.quad((bx0, by0, -D), (bx0, by0, 0), (bx1, by0, 0), (bx1, by0, -D))
    b.quad((bx0, by1, -D), (bx1, by1, -D), (bx1, by1, 0), (bx0, by1, 0))
    b.build('basin', cyan, (1, 1))
    Part().floor(bx0, by0, bx1, by1, -0.25).build('hs_water', material('water', (0.55, 0.85, 0.88)), (2, 2), hotspot='water')
    w = Part()
    wall(w, -W, 0, -W, L, H); wall(w, W, 0, W, L, H)
    wall(w, -W, 0, W, 0, H); wall(w, -W, L, W, L, H)
    for y in range(4, 31, 4):
        for x in (-6.5, 6.5):
            w.box((x - 0.25, y - 0.25, 0), (x + 0.25, y + 0.25, H))
    w.build('walls', white, (1, 1))
    c = Part()
    holes = [(8, 11), (16, 19), (24, 27)]
    ys = [0] + [v for h in holes for v in h] + [L]
    for i in range(0, len(ys), 2):
        c.ceiling(-W, ys[i], W, ys[i + 1], H)
    for (y0, y1) in holes:
        c.ceiling(-W, y0, -3, y1, H).ceiling(3, y0, W, y1, H)
        c.box((-3.1, y0, H), (-3, y1, H + 0.6)).box((3, y0, H), (3.1, y1, H + 0.6))
        c.box((-3, y0 - 0.1, H), (3, y0, H + 0.6)).box((-3, y1, H), (3, y1 + 0.1, H + 0.6))
    c.build('ceiling', white, (1, 1))
    sky = material('skylight', (1, 1, 1), emit=(0.92, 0.96, 1.0), strength=6)
    for i, (y0, y1) in enumerate(holes):
        Part().ceiling(-3, y0, 3, y1, H + 0.6).build('hs_skylight' if i == 1 else f'sky_{i}', sky, **({'hotspot': 'skylight', 'neon': 1} if i == 1 else {'neon': 1}))
        area_light(0, (y0 + y1) / 2, H + 0.55, 6, 3, 1400, (0.92, 0.96, 1.0))
    lad = Part()
    for x in (-4.1, -3.5):
        lad.box((x - 0.03, 8.0, -D), (x + 0.03, 8.06, 0.9)).box((x - 0.03, 7.6, 0.85), (x + 0.03, 8.06, 0.91))
        lad.box((x - 0.03, 7.6, 0), (x + 0.03, 7.66, 0.9))
    for z in (-1.2, -0.8, -0.4):
        lad.box((-4.1, 8.0, z), (-3.5, 8.18, z + 0.04))
    lad.build('hs_ladder', material('chrome', (0.75, 0.77, 0.78)), hotspot='ladder')
    for i, (x, y) in enumerate([(-6, 14), (6, 22), (-2, 29.5), (5.5, 9)]):
        spot(i, x, y)
    # deck strips are x 4.5..7.9 either side of the basin; pillars at x=±6.5 every 4 m
    P = Props()
    P.put(lifeguard_chair, 5.6, 15.0, a=-R90)
    P.put(lifebuoy_wall, -6.25, 12.0, 1.4, a=R90)
    P.put(lifebuoy, 7.0, 19.0)
    P.put(folding_chair, -5.4, 18.0, a=R90)
    P.put(folding_chair, -7.2, 18.3, a=R90 + 0.4)
    P.put(towel, -5.6, 22.6, a=0.15)
    P.put(kickboard, 5.3, 11.4, a=0.5)
    P.put(text_sign, -7.87, 10.0, 2.0, a=R90, text='DILARANG MENYELAM', w=2.6, h=0.6)
    P.build('props')
    glitch('clip', 'white', folding_chair, 5.8, 28.8, -0.22, a=-0.5, tilt=(0.3, -0.2))  # sunk into the tiles
    glitch('float', 'red', lifebuoy, 2.6, 20.0, 0.15, tilt=(0.2, 0.1))                   # 0.4 m above the water
    glitch('double', 'white', ball, -5.4, 26.0)
    glitch('missing', 'blue', crate, -7.2, 30.5)

def corridor():
    H, W, L = 3.0, 1.7, 32.0
    set_world((0.01, 0.012, 0.015), 0.3)
    Part().floor(-W, 0, W, L).build('floor', material('linoleum', tex='linoleum'), (1.2, 1.2))
    Part().ceiling(-W, 0, W, L, H).build('ceiling', material('ceiling', tex='ceiling'), (1.2, 1.2))
    w = Part()
    wall(w, -W, 0, -W, L, H, 0.15); wall(w, W, 0, W, L, H, 0.15)
    wall(w, -W, 0, W, 0, H, 0.15)
    end_wall(w, L, -3, 3, H, 0.9, 2.2)  # stays open: the silhouette stands in this doorway
    w.build('walls', material('wainscot', tex='wainscot'), (1.0, H))
    wood = material('wood', tex='wood')
    d = Part()
    for i, y in enumerate(range(3, 31, 4)):
        for side in (-1, 1):
            if side == 1 and 14 <= y <= 22:
                continue  # lockers here
            if (side, y) == (-1, 11):
                continue
            x = side * (W - 0.09)
            d.box((x - 0.03, y - 0.45, 0), (x + 0.03, y + 0.45, 2.1))
    d.build('doors', wood, (0.9, 2.1))
    Part().box((-W + 0.06, 10.55, 0), (-W + 0.12, 11.45, 2.1)).build('hs_door', wood, (0.9, 2.1), hotspot='door')
    Part().box((W - 0.5, 14, 0), (W - 0.08, 22, 1.9)).build('hs_locker', material('locker', tex='locker'), (0.4, 1.9), hotspot='locker')
    on, off = Part(), Part()
    for y in range(2, 31, 4):
        (off if y in (22, 26) else on).ceiling(-0.3, y - 0.6, 0.3, y + 0.6, H - 0.01)
        if y not in (22, 26):
            area_light(0, y, H - 0.02, 0.6, 1.2, 55, (0.9, 0.97, 1.0))
    on.build('neon', NEON(), neon=1)
    off.build('neon_dead', NEON_OFF())
    Part().box((-0.25, L - 0.2, 2.45), (0.25, L - 0.1, 2.65)).build('hs_exit_sign', material('exit', (0.2, 1, 0.4), emit=(0.2, 1.0, 0.4), strength=8), hotspot='exit_sign', neon=1)
    point_light(0, L - 0.5, 2.5, 6, (0.3, 1, 0.5))
    for i, (x, y) in enumerate([(0, 28.5), (-0.7, 23), (0.6, 30.5)]):
        spot(i, x, y)
    empty('anchor_silhouette', 0, 32.3, 0)
    # only the 0.4 m strips between |x|=1.2 and the wall face (1.625) are usable, between the doors
    F = W - 0.075
    P = Props()
    P.put(trash_can, 1.4, 5.0)
    P.put(trash_can, -1.4, 17.0)
    P.put(notice_board, F - 0.03, 12.95, 1.1, a=-R90)
    P.put(extinguisher, F - 0.1, 25.0, 1.0, a=-R90)
    P.put(extinguisher, -F + 0.1, 5.0, 1.0, a=R90)
    P.put(wall_clock, F, 18.0, 2.4, a=-R90)
    P.put(drinking_fountain, F, 9.0, a=-R90)
    P.put(bench_seat, -F + 0.2, 13.0, a=R90)
    P.put(mop_bucket, 1.42, 29.3, a=-R90)
    P.build('props')
    glitch('clip', 'dark', office_chair, -1.7, 9.0, -0.05, a=R90 + 0.3, tilt=(0.0, 0.25))  # half inside the wall
    glitch('float', 'cardboard', carton, -1.48, 21.0, 0.4, a=0.4, tilt=(0.2, 0.3), w=0.3, d=0.3, h=0.3)
    glitch('double', 'green', plant, -1.4, 25.0, s=0.6)
    glitch('missing', 'white', poster, -F + 0.001, 28.9, 1.2, a=R90)

def mall():
    H, W, L, M = 9.0, 11.0, 34.0, 4.5
    set_world((0.02, 0.025, 0.04), 0.5)
    Part().floor(-W, 0, W, L).build('floor', material('mallfloor', tex='mallfloor'), (1, 1))
    plaster = material('plaster', (0.70, 0.68, 0.63))
    s = Part()
    wall(s, -W, 0, -W, L, H); wall(s, W, 0, W, L, H)
    wall(s, -W, 0, W, 0, H); wall(s, -W, L, W, L, H)
    for side in (-1, 1):
        s.box((7 if side > 0 else -11, 0, M - 0.3), (11 if side > 0 else -7, L, M))  # mezzanine walkway
        for y in range(0, 35, 6):
            x = side * 8.6
            s.box((x - 0.3, y - 0.3, 0), (x + 0.3, y + 0.3, H))
    s.build('structure', plaster, (1, 1))
    sh = Part()
    for side in (-1, 1):
        for z0, z1 in ((0, 3.2), (M, M + 3.2)):
            for y in range(0, 34, 6):
                x = side * 10.7
                sh.box((x - 0.05, y + 0.4, z0), (x + 0.05, y + 5.6, z1))
    sh.build('shutters', material('shutter', tex='shutter'), (1, 1))
    r = Part()
    for side in (-1, 1):
        x = side * 7.1
        r.box((x - 0.04, 0, M + 1.0), (x + 0.04, L, M + 1.08))
        for y in np.arange(0.5, L, 1.5):
            r.box((x - 0.02, y - 0.02, M), (x + 0.02, y + 0.02, M + 1.0))
    r.build('railing', material('chrome', (0.75, 0.77, 0.78)))
    c = Part()
    c.ceiling(-W, 0, -3, L, H).ceiling(3, 0, W, L, H)
    c.box((-3.1, 0, H), (-3, L, H + 0.8)).box((3, 0, H), (3.1, L, H + 0.8))
    c.build('ceiling', plaster, (1, 1))
    Part().ceiling(-3, 0, 3, L, H + 0.8).build('skylight', material('moon', (1, 1, 1), emit=(0.55, 0.65, 0.95), strength=2.2), neon=1)
    for y in (6, 17, 28):
        area_light(0, y, H + 0.75, 6, 10, 900, (0.55, 0.66, 1.0))
    for (x, y) in [(-8.2, 5), (8.2, 13), (-8.2, 21), (8.2, 29)]:
        point_light(x, y, M - 0.45, 25, (1.0, 0.75, 0.45))
    esc = Part()
    esc.slab((-5, 22, 0.15), 7.5, 1.2, M - 0.15, 0.3)
    for dx in (-0.7, 0.7):
        esc.slab((-5 + dx, 21.5, 1.1), 7.5, 0.12, M - 0.15, 1.0)
    esc.box((-5.8, 29.5, M - 0.3), (-4.2, 31, M))
    esc.build('hs_escalator', material('escalator', (0.25, 0.26, 0.27)), hotspot='escalator')
    fo = Part().cylinder(0, 16, 0, 2.6, 0.5).cylinder(0, 16, 0.5, 0.35, 1.0).cylinder(0, 16, 1.5, 1.0, 0.15)
    fo.build('hs_fountain', material('stone', (0.62, 0.6, 0.55)), hotspot='fountain')
    Part().cylinder(0, 16, 0.5, 2.35, 0.02).build('fountain_dry', material('dry', (0.32, 0.30, 0.26)))
    def bench(p, x, y):
        p.box((x - 1, y - 0.25, 0.4), (x + 1, y + 0.25, 0.48))
        for dx in (-0.85, 0.85):
            p.box((x + dx - 0.05, y - 0.2, 0), (x + dx + 0.05, y + 0.2, 0.4))
        return p
    bench(Part(), 4, 10).build('hs_bench', wood_m := material('wood', tex='wood'), (0.9, 0.9), hotspot='bench')
    bench(Part(), -4, 8).build('bench_2', wood_m, (0.9, 0.9))
    pl = Part()
    for (x, y) in [(-4.5, 13), (4.5, 19), (-4.5, 25), (4.5, 4)]:
        pl.box((x - 0.6, y - 0.6, 0), (x + 0.6, y + 0.6, 0.8))
    pl.build('planters', material('planter', (0.35, 0.33, 0.30)))
    for i, (x, y, z) in enumerate([(6, 20, 0), (-7, 12, 0), (0.5, 31, 0), (3, 26, 0), (9.6, 18, M)]):
        spot(i, x, y, z)
    empty('anchor_partygoer', -5, 30.2, M)
    # the camera detours to x=3 around the fountain (y 13-19), so x 1.5..4.5 stays clear for y 10-22
    P = Props()
    P.put(trolley, -5.5, 3.5, a=0.35)
    P.put(trolley, 6.5, 25.5, a=-2.0)
    P.put(mannequin, -9.7, 14.4, a=R90)
    P.put(mannequin, -9.6, 15.7, a=R90 - 0.3)
    P.put(kiosk_cart, 5.5, 31.0, a=0.1)
    P.put(plant, -9.6, 2.5)
    P.put(plant, 9.6, 31.5)
    P.put(directory_board, -2.6, 6.0)
    P.put(trash_can, 2.5, 7.0, r=0.25, h=0.8)
    P.put(wet_sign, -2.2, 21.0, a=0.5)
    P.build('props')
    glitch('clip', 'chrome', trolley, -6.5, 16.5, -0.3, a=1.0, tilt=(0.4, 0.15))  # nose-down in the floor
    glitch('float', 'green', plant, 2.4, 29.0, 0.4, tilt=(0.15, -0.1))
    glitch('double', 'white', mannequin, 8.0, 8.5, a=-R90)
    glitch('missing', 'red', vending, -10.0, 27.0, a=R90)

def entity():
    p = Part()
    p.box((-0.16, -0.07, 0), (-0.06, 0.07, 1.15)).box((0.06, -0.07, 0), (0.16, 0.07, 1.15))  # legs
    p.box((-0.2, -0.09, 1.1), (0.2, 0.09, 1.95))  # torso
    p.box((-0.3, -0.05, 0.75), (-0.22, 0.05, 1.92)).box((0.22, -0.05, 0.7), (0.3, 0.05, 1.92))  # long arms
    p.box((-0.05, -0.05, 1.95), (0.05, 0.05, 2.08))  # neck
    p.sphere(0, 0, 2.22, 0.14, 0.9, 0.95, 1.25)  # faceless head
    p.build('entity', material('entity', (0.015, 0.014, 0.013)), entity=1)

# Entities: origin at the feet, facing Blender -Y, no bake (the runtime draws them unlit).
def tall():
    """~2.6 m, emaciated, overlong limbs, slight forward hunch, small featureless head. Own design."""
    p = Part()
    for s in (-1, 1):
        p.seg((s * 0.09, 0, 1.38), (s * 0.11, -0.03, 0.72), 0.045, 0.035).sphere(s * 0.11, -0.03, 0.72, 0.04)
        p.seg((s * 0.11, -0.03, 0.72), (s * 0.12, 0.02, 0.06), 0.035, 0.022)
        p.box((s * 0.12 - 0.035, -0.13, 0), (s * 0.12 + 0.035, 0.04, 0.05))
        p.seg((s * 0.22, -0.18, 2.25), (s * 0.27, -0.22, 1.62), 0.03, 0.024).sphere(s * 0.27, -0.22, 1.62, 0.03)
        p.seg((s * 0.27, -0.22, 1.62), (s * 0.29, -0.28, 0.98), 0.024, 0.018)
        p.seg((s * 0.29, -0.28, 0.98), (s * 0.3, -0.31, 0.68), 0.02, 0.006)  # long, tapering fingers
    p.sphere(0, 0, 1.4, 0.11, 1.1, 0.7, 0.6)
    p.seg((0, 0, 1.4), (0, -0.06, 1.85), 0.06, 0.1).seg((0, -0.06, 1.85), (0, -0.17, 2.24), 0.1, 0.11)
    p.seg((-0.22, -0.18, 2.26), (0.22, -0.18, 2.26), 0.045)
    p.seg((0, -0.19, 2.28), (0, -0.31, 2.42), 0.03, 0.025)
    p.sphere(0, -0.34, 2.5, 0.085, 0.85, 0.95, 1.3)
    p.build('tall', material('entity', (0.015, 0.014, 0.013)), entity=1)

def silhouette():
    """An ordinary 1.75 m person."""
    p = Part()
    for s in (-1, 1):
        p.seg((s * 0.1, 0, 0.92), (s * 0.1, 0, 0.06), 0.068, 0.05)
        p.box((s * 0.1 - 0.045, -0.16, 0), (s * 0.1 + 0.045, 0.05, 0.07))
        p.seg((s * 0.22, 0, 1.42), (s * 0.25, -0.02, 0.8), 0.045, 0.035)
    p.seg((0, 0, 0.9), (0, 0, 1.44), 0.15, 0.19, 10).seg((-0.21, 0, 1.43), (0.21, 0, 1.43), 0.055)
    p.seg((0, 0, 1.44), (0, 0, 1.54), 0.05)
    p.sphere(0, 0, 1.635, 0.105, 0.9, 1.0, 1.1)
    p.build('silhouette', material('entity', (0.015, 0.014, 0.013)), entity=1)

def partygoer():
    """Yellow costume body; separate `head` object pivoting at the neck, face from TEX['partyface']."""
    NECK, R = 1.45, 0.24
    p = Part()
    for s in (-1, 1):
        p.seg((s * 0.12, 0, 0.75), (s * 0.12, 0, 0.06), 0.09, 0.08, 10)
        p.box((s * 0.12 - 0.06, -0.2, 0), (s * 0.12 + 0.06, 0.06, 0.08))
        p.seg((s * 0.28, 0, 1.3), (s * 0.42, -0.05, 0.82), 0.07, 0.06, 10).sphere(s * 0.43, -0.05, 0.78, 0.07)
    p.sphere(0, 0, 1.05, 0.32, 1, 0.8, 1.25)
    p.build('partygoer', material('party_body', (1.0, 0.84, 0.08)), entity=1)
    head = Part().sphere(0, 0, R, R, 1, 1, 0.95).build('head', material('party_face', tex='partyface'), entity=1)
    head.location.z = NECK
    uv = head.data.uv_layers['uv'].data
    for poly in head.data.polygons:  # front hemisphere gets the face, the back a yellow corner
        front = poly.center.y < 0
        for li in poly.loop_indices:
            c = head.data.vertices[head.data.loops[li].vertex_index].co
            uv[li].uv = (0.5 + c.x / (2 * R), 0.5 + (c.z - R) / (2 * R * 0.95)) if front else (0.02, 0.02)

ENTITIES = ('entity', 'tall', 'silhouette', 'partygoer')

# ---------------------------------------------------------------- bake + export
def bake_lightmap(room):
    sc = bpy.context.scene
    objs = [o for o in sc.objects if o.type == 'MESH' and not o.get('neon')]
    img = bpy.data.images.new(room + '_lm_f', LM, LM, alpha=False, float_buffer=True)
    for o in objs:
        uvs = o.data.uv_layers
        lm = uvs.get('lightmap') or uvs.new(name='lightmap')
        uvs.active = lm
        uvs['uv'].active_render = True
        for m in o.data.materials:
            n = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.name == 'LM'), None)
            if n is None:
                n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.name = 'LM'
            n.image = img
            m.node_tree.nodes.active = n
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, use_clear=True, target='IMAGE_TEXTURES')
    px = np.empty(LM * LM * 4, np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3]
    lum = rgb.max(1)
    k = 0.95 / max(float(np.percentile(lum[lum > 1e-5], 99.5)), 1e-4)
    enc = np.clip(rgb * k, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)  # linear -> sRGB
    out = bpy.data.images.new(room + '_lm', LM, LM, alpha=False)
    o4 = np.ones((LM * LM, 4), np.float32); o4[:, :3] = enc
    out.pixels.foreach_set(o4.ravel())
    out.filepath_raw = os.path.join(OUT, room + '_lm.webp')
    out.file_format = 'WEBP'
    out.save()
    # remove helper nodes so the exporter only sees the albedo
    for o in objs:
        for m in o.data.materials:
            n = m.node_tree.nodes.get('LM')
            if n: m.node_tree.nodes.remove(n)
    meta_path = os.path.join(OUT, 'lightmaps.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    meta[room] = {'intensity': round(math.pi / k, 4)}
    json.dump(meta, open(meta_path, 'w'), indent=2)
    return k

def export(room):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        o.select_set(o.type in ('MESH', 'EMPTY'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, room + '.glb'), export_format='GLB', use_selection=True,
                              use_active_scene=True, export_extras=True, export_image_format='WEBP', export_normals=False,
                              export_tangents=False, export_lights=False, export_cameras=False,
                              export_yup=True, export_apply=True, export_texcoords=True)

def run(room):
    import time
    os.makedirs(OUT, exist_ok=True)
    t = time.time()
    fresh_scene()
    globals()[room]()
    k = bake_lightmap(room) if room not in ENTITIES else None
    export(room)
    print(room, 'done in', round(time.time() - t, 1), 's  k=', k,
          'glb KB=', os.path.getsize(os.path.join(OUT, room + '.glb')) // 1024)

if 'ROOM' in globals():
    run(ROOM)
