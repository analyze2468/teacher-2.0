/**
 * 3D 首页 · 场景层（React + @react-three/fiber + Drei）
 *
 * 竖版启动页：一条笔直的夜间跑道向远处延伸，车道虚线朝镜头方向流动，
 * 两侧蓝色光轨持续向前推进，形成「一直往前跑」的节奏感；
 * 前景偏右是一个冲刺的少年（2.5D 精灵面片，接入方式见下方 RUNNER 段注释）。
 *
 * 依赖通过 index.html 的 importmap 从 esm.sh 加载：本文件只在 landing.js 动态 import
 * 时才会被请求，CDN 不可达时不会阻塞首页 UI。
 *
 * 性能约定（对齐 3D 前端 skill / r3f-cube-min.html 的无构建范式）：
 * - frameloop="demand"：只有调用 invalidate() 才渲染，标签页隐藏时彻底停帧；
 * - 全部 MeshBasicMaterial + 现场绘制的 CanvasTexture，无灯光 / 阴影 / 后处理；
 * - 贴图在卸载时 dispose，光轨材质由 R3F 自动回收，反复开关 3D 不涨显存；
 * - 帧内只做数值 mutate，不 setState、不 new 对象（docs/advanced/pitfalls.mdx）。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei/AdaptiveDpr';

const html = htm.bind(React.createElement);

const COLOR = {
  bg: '#05070d',
  track: '#0a1220',
  edge: '#3b82f6',
  rail: '#60a5fa',
  railAlt: '#22d3ee',
  haze: '#1d4ed8'
};

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 480;
const lowPower = coarsePointer || smallScreen;

/**
 * 跑道参数：宽 6.4、长 120，相机在近端上方看向远端。
 * tile = 一屏贴图覆盖的世界长度，repeat = length / tile；
 * scroll = 每秒滚过多少个 tile（1 → 5 单位/秒），数值越大越有冲刺感。
 */
const TRACK = {
  width: 6.4,
  length: 120,
  centerZ: -48,
  tile: 5,
  repeat: 24,
  scroll: 0.55
};

/* ------------------------------ 跑道贴图 ------------------------------ */

/**
 * 用 Canvas 现场绘制跑道条纹：深色底 + 车道边界 + 内侧细线 + 中心虚线。
 * 虚线周期取 64px，正好整除 256px 的贴图高度，纵向平铺时不会出现接缝。
 */
function createTrackTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#060a12';
  ctx.fillRect(0, 0, 256, 256);

  // 沥青面
  ctx.fillStyle = '#0a1220';
  ctx.fillRect(26, 0, 204, 256);

  // 车道边界（亮蓝，靠泛光贴边表现跑道灯）
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(26, 0);
  ctx.lineTo(26, 256);
  ctx.moveTo(230, 0);
  ctx.lineTo(230, 256);
  ctx.stroke();

  // 内侧细线：弱一些，给跑道一点层次
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 256);
  ctx.moveTo(192, 0);
  ctx.lineTo(192, 256);
  ctx.stroke();

  // 中心虚线：一段实一段空，滚动时最有速度感
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
  ctx.lineWidth = 5;
  ctx.setLineDash([30, 34]);
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  ctx.setLineDash([]);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, TRACK.repeat);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------ 远端光雾贴图 ------------------------------ */

/** 地平线上的蓝色光雾：一张径向渐变贴图，暗示「终点还亮着」 */
function createHazeTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(147, 197, 253, 0.9)');
  gradient.addColorStop(0.32, 'rgba(59, 130, 246, 0.34)');
  gradient.addColorStop(1, 'rgba(29, 78, 216, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------ 奔跑的少年（前景） ------------------------------ */

/**
 * 人物接入方案：2.5D 精灵面片（不是骨骼小人）
 *
 * 1. 美术：assets/img/landing-runner.svg —— 570×650 的手绘矢量立绘，
 *    白色短袖校服 + 深蓝短裤 + 白蓝跑鞋，冲刺姿态（后腿拖曳、前腿前跨、手臂前后摆）。
 * 2. 载体：一张竖直 planeGeometry 贴在 CANVAS 前方 z = 1 处（跑道中景），正对相机；
 *    贴图带 alpha，材质 transparent + alphaTest，跑道光轨从人身后穿过。
 * 3. 融入 3D：人物组额外叠四张现场绘制的软边贴图 ——
 *    · 加色辉光：模拟赛道蓝光打在人物背后的逆光（AdditiveBlending）；
 *    · 接触阴影：贴地椭圆，让脚落在跑道上而不是飘着；
 *    · 地面光池：脚下跑道被冷光轻微照亮，避免人物「贴」在画面上；
 *    · 湿地倒影：同贴图绕脚底镜像 + 垂直渐隐 alphaMap，depthTest:false 画在跑道之上。
 * 4. 动效：只在帧内做 sin 微动（上下 0.012、侧倾 0.01rad、横向 0.004），
 *    配合跑道前伸与光轨掠过，形成「轻微循环奔跑」，不换帧、不改贴图。
 */
const RUNNER_URL = 'assets/img/landing-runner.svg';

const RUNNER = {
  z: 1,
  aspect: 570 / 650,
  heightPortrait: 0.29,
  heightLandscape: 0.52,
  xPortrait: 0.64,
  xLandscape: 0.7,
  edge: 0.975
};

/** 现场绘制软边贴图：fade 给倒影做 alphaMap，glow 做逆光，shadow 做接触阴影 */
function createSoftTexture(kind) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (kind === 'fade') {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'glow') {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.82)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.26)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  } else {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.32)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Runner({ paused }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const group = React.useRef(null);
  const glow = React.useRef(null);
  const body = React.useRef(null);
  const shadow = React.useRef(null);
  const pool = React.useRef(null);
  const reflection = React.useRef(null);
  const textureRef = React.useRef(null);
  const [texture, setTexture] = React.useState(null);

  const soft = React.useMemo(
    () => ({
      fade: createSoftTexture('fade'),
      glow: createSoftTexture('glow'),
      shadow: createSoftTexture('shadow')
    }),
    []
  );

  React.useEffect(() => {
    const list = Object.values(soft);
    return () => {
      list.forEach((item) => {
        if (item) item.dispose();
      });
    };
  }, [soft]);

  React.useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      RUNNER_URL,
      (loaded) => {
        if (!alive) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 4;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        textureRef.current = loaded;
        setTexture(loaded);
      },
      undefined,
      () => {
        /* 贴图失败（离线 / 被拦截）：跑道与光轨照常，只是少一个人 */
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(
    () => () => {
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
    },
    []
  );

  // 每帧按当前相机重算「屏幕比例 → 世界尺寸」：横竖屏切换、改 fov / 相机位置都能自动跟上
  const applyLayout = React.useCallback(() => {
    // 直接用渲染所用投影矩阵的元素换算：Vector3.project() 在首帧可能拿到过期矩阵
    const m = camera.projectionMatrix.elements;
    const dist = Math.max(camera.position.z - RUNNER.z, 0.5);
    const kx = Math.abs(m[0] / dist) || 1e-6;
    const ky = Math.abs(m[5] / dist) || 1e-6;
    const portrait = size.height >= size.width;
    const hFrac = portrait ? RUNNER.heightPortrait : RUNNER.heightLandscape;
    // 人物宽度占屏宽的比例：heightFrac × 立绘宽高比 ÷ 屏幕宽高比
    const widthFrac = hFrac * RUNNER.aspect * (kx / ky);
    const target = portrait ? RUNNER.xPortrait : RUNNER.xLandscape;
    const centerX = Math.max(widthFrac / 2 + 0.03, Math.min(target, RUNNER.edge - widthFrac / 2));
    const height = (2 * hFrac) / ky;
    return { width: height * RUNNER.aspect, height, x: (2 * centerX - 1) / kx };
  }, [camera, size.width, size.height, tmp]);



  useFrame((state) => {
    if (paused.current || !group.current) return;
    const t = state.clock.elapsedTime;
    const { width, height, x } = applyLayout();

    // 轻微循环奔跑：上下浮动 + 微侧倾 + 微横向漂移，幅度压在「看得到但不抢戏」
    group.current.position.x = x + Math.sin(t * 2.4) * 0.004;
    group.current.position.y = Math.sin(t * 5.1) * 0.012;
    group.current.rotation.z = Math.sin(t * 5.1 + 1.15) * 0.009;

    if (body.current) {
      body.current.position.y = height / 2 - 0.01;
      body.current.scale.set(width, height, 1);
    }
    if (glow.current) {
      glow.current.position.y = height * 0.52;
      glow.current.scale.set(width * 2.6, height * 1.7, 1);
      if (glow.current.material) {
        glow.current.material.opacity = 0.4 + Math.sin(t * 2.2) * 0.08;
      }
    }
    if (shadow.current) shadow.current.scale.set(width * 1.05, width * 0.52, 1);
    if (pool.current) pool.current.scale.set(width * 1.5, width * 0.95, 1);
    if (reflection.current) {
      reflection.current.position.y = -(height * 0.3) / 2;
      reflection.current.scale.set(width, -height * 0.3, 1);
    }
  });

  return html`
    <group ref=${group} position=${[0, 0, RUNNER.z]}>
      ${texture
        ? html`
            <!-- 逆光：赛道蓝光从背后打亮人物 -->
            <mesh ref=${glow} position=${[0, 0, -0.3]}>
              <planeGeometry args=${[1, 1]} />
              <meshBasicMaterial
                map=${soft.glow || undefined}
                color="#2f6bff"
                transparent
                opacity=${0.4}
                depthWrite=${false}
                fog=${false}
                blending=${THREE.AdditiveBlending}
              />
            </mesh>

            <!-- 接触阴影：让脚落在跑道上 -->
            <mesh ref=${shadow} rotation=${[-Math.PI / 2, 0, 0]} position=${[0, 0.014, 0.25]}>
              <planeGeometry args=${[1, 1]} />
              <meshBasicMaterial
                map=${soft.shadow || undefined}
                transparent
                opacity=${0.72}
                depthWrite=${false}
                fog=${false}
              />
            </mesh>

            <!-- 地面光池：人物脚下的跑道被赛道冷光轻微照亮，避免人物「贴」在画面上 -->
            <mesh ref=${pool} rotation=${[-Math.PI / 2, 0, 0]} position=${[0, 0.012, -0.05]}>
              <planeGeometry args=${[1, 1]} />
              <meshBasicMaterial
                map=${soft.glow || undefined}
                color="#1e40af"
                transparent
                opacity=${0.2}
                depthWrite=${false}
                fog=${false}
                blending=${THREE.AdditiveBlending}
              />
            </mesh>

            <!-- 湿地倒影：镜像 + 垂直渐隐；depthTest 关掉才不会被跑道面挡住 -->
            <mesh ref=${reflection} position=${[0, 0, 0.04]} renderOrder=${1}>
              <planeGeometry args=${[1, 1]} />
              <meshBasicMaterial
                map=${texture}
                alphaMap=${soft.fade || undefined}
                color="#7fb2ff"
                transparent
                opacity=${0.26}
                depthWrite=${false}
                depthTest=${false}
                side=${THREE.DoubleSide}
                blending=${THREE.AdditiveBlending}
                fog=${false}
              />
            </mesh>

            <!-- 人物本体：带 alpha 的立绘面片，叠在光轨之上 -->
            <mesh ref=${body} position=${[0, 0, 0]} renderOrder=${2}>
              <planeGeometry args=${[1, 1]} />
              <meshBasicMaterial
                map=${texture}
                transparent
                alphaTest=${0.02}
                depthWrite=${false}
                fog=${false}
                toneMapped=${false}
              />
            </mesh>
          `
        : null}
    </group>
  `;
}

/* --------------------------------- 地面 --------------------------------- */

function Ground() {
  return html`
    <mesh rotation=${[-Math.PI / 2, 0, 0]} position=${[0, -0.03, -40]}>
      <planeGeometry args=${[220, 260]} />
      <meshBasicMaterial color="#04060b" />
    </mesh>
  `;
}

/* --------------------------------- 跑道 --------------------------------- */

function Track({ paused }) {
  const texture = React.useMemo(createTrackTexture, []);

  React.useEffect(() => {
    return () => {
      if (texture) texture.dispose();
    };
  }, [texture]);

  useFrame((_, delta) => {
    if (paused.current || !texture) return;
    const dt = Math.min(delta, 0.05);
    // offset.y 递增 → 贴图朝镜头方向滚动，等价于「人一直往前跑」
    texture.offset.y = (texture.offset.y + dt * TRACK.scroll) % 1;
  });

  return html`
    <group>
      <mesh rotation=${[-Math.PI / 2, 0, 0]} position=${[0, 0, TRACK.centerZ]}>
        <planeGeometry args=${[TRACK.width, TRACK.length]} />
        <meshBasicMaterial
          map=${texture || undefined}
          color=${texture ? '#ffffff' : COLOR.track}
        />
      </mesh>

      ${[-1, 1].map((side) => {
        const x = side * (TRACK.width / 2 - 0.03);
        return html`
          <group key=${side}>
            <!-- 跑道边缘灯带：细亮线 + 外侧一层很淡的蓝色泛光 -->
            <mesh rotation=${[-Math.PI / 2, 0, 0]} position=${[x, 0.006, TRACK.centerZ]}>
              <planeGeometry args=${[0.09, TRACK.length]} />
              <meshBasicMaterial
                color=${COLOR.edge}
                transparent
                opacity=${0.5}
                depthWrite=${false}
                blending=${THREE.AdditiveBlending}
              />
            </mesh>
            <mesh
              rotation=${[-Math.PI / 2, 0, 0]}
              position=${[side * (TRACK.width / 2 + 0.42), 0.004, TRACK.centerZ]}
            >
              <planeGeometry args=${[1.25, TRACK.length]} />
              <meshBasicMaterial
                color=${COLOR.haze}
                transparent
                opacity=${0.12}
                depthWrite=${false}
                blending=${THREE.AdditiveBlending}
              />
            </mesh>
          </group>
        `;
      })}
    </group>
  `;
}

/* -------------------------------- 光轨推进 -------------------------------- */

const RAIL_COUNT = lowPower ? 7 : 11;

function createRails() {
  return Array.from({ length: RAIL_COUNT }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    return {
      key: index,
      x: side * (TRACK.width / 2 + 0.3 + Math.random() * 0.75),
      y: 0.05 + Math.random() * 0.04,
      z: -8 - Math.random() * 78,
      length: 5 + Math.random() * 13,
      width: 0.05 + Math.random() * 0.05,
      speed: 13 + Math.random() * 9,
      alt: Math.random() > 0.68
    };
  });
}

/**
 * 光轨：细长条沿 Z 轴朝镜头推进，出画后回收到远处重新来。
 * 用 AdditiveBlending + depthWrite:false 叠出「光」的感觉，不参与雾计算，
 * 亮度按距离手动淡出，远景自然消融在地平线光雾里。
 */
function Rails({ paused }) {
  const group = React.useRef(null);
  const rails = React.useMemo(createRails, []);

  useFrame((_, delta) => {
    if (paused.current || !group.current) return;
    const dt = Math.min(delta, 0.05);
    const children = group.current.children;

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const rail = rails[i];
      if (!rail) continue;

      child.position.z += rail.speed * dt;
      if (child.position.z > 9) {
        child.position.z = -86 - Math.random() * 26;
        child.position.x =
          (i % 2 === 0 ? -1 : 1) * (TRACK.width / 2 + 0.3 + Math.random() * 0.75);
      }

      // 远处淡、贴近镜头也收一点，避免光轨糊在屏幕上
      const far = Math.min(1, Math.max(0, 1 + child.position.z / 95));
      const near = Math.min(1, Math.max(0, (9 - child.position.z) / 6));
      child.material.opacity = (0.05 + 0.17 * far) * near;
    }
  });

  return html`
    <group ref=${group}>
      ${rails.map(
        (rail) => html`
          <mesh key=${rail.key} position=${[rail.x, rail.y, rail.z]}>
            <boxGeometry args=${[rail.width, 0.02, rail.length]} />
            <meshBasicMaterial
              color=${rail.alt ? COLOR.railAlt : COLOR.rail}
              transparent
              opacity=${0.18}
              depthWrite=${false}
              fog=${false}
              blending=${THREE.AdditiveBlending}
            />
          </mesh>
        `
      )}
    </group>
  `;
}

/* -------------------------------- 地平线光雾 -------------------------------- */

function Haze() {
  const texture = React.useMemo(createHazeTexture, []);

  React.useEffect(() => {
    return () => {
      if (texture) texture.dispose();
    };
  }, [texture]);

  return html`
    <sprite position=${[0, 1.15, -92]} scale=${[48, 21, 1]}>
      <spriteMaterial
        map=${texture || undefined}
        color=${COLOR.haze}
        transparent
        opacity=${0.55}
        depthWrite=${false}
        fog=${false}
        blending=${THREE.AdditiveBlending}
      />
    </sprite>
  `;
}

/* ------------------------------ 相机 / 帧调度 ------------------------------ */

/** 供 controller 恢复渲染时手动触发一帧（frameloop="demand" 必需） */
let requestFrame = null;

/**
 * 相机：低机位正视跑道，只做极轻微的横向漂移与呼吸感，
 * 保证「竖屏一镜到底」的主体稳定，不抢文案与按钮的注意力。
 */
function CameraRig({ paused }) {
  const camera = useThree((state) => state.camera);
  const clock = React.useRef(0);

  useFrame((_, delta) => {
    if (paused.current) return;
    clock.current += Math.min(delta, 0.05);
    const t = clock.current;

    camera.position.x = Math.sin(t * 0.32) * 0.05;
    camera.position.y = 1.5 + Math.sin(t * 0.47) * 0.02;
    camera.lookAt(0, 0.55, -16);
  });

  return null;
}

/**
 * 帧调度：frameloop="demand" 下由自己持续 invalidate 形成动画循环，
 * 暂停时不再请求新帧 => 标签页隐藏 / 关闭 3D 时 GPU 完全空闲。
 */
function FrameDriver({ paused, onDegrade }) {
  const invalidate = useThree((state) => state.invalidate);
  const regress = useThree((state) => (state.performance ? state.performance.regress : null));
  const stats = React.useRef({ time: 0, frames: 0, degraded: false });

  React.useEffect(() => {
    requestFrame = () => invalidate();
    return () => {
      requestFrame = null;
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    if (paused.current) return;
    const stat = stats.current;
    stat.time += delta;
    stat.frames += 1;
    if (stat.time >= 1.5) {
      const fps = stat.frames / stat.time;
      if (fps < 48 && !stat.degraded && typeof regress === 'function') {
        stat.degraded = true;
        regress(); // 交给 Drei AdaptiveDpr 降采样
        if (onDegrade) onDegrade(fps);
      }
      stat.time = 0;
      stat.frames = 0;
    }
    invalidate();
  });

  return null;
}

/* --------------------------------- 场景 --------------------------------- */

function Scene({ paused, onReady, onDegrade }) {
  React.useEffect(() => {
    if (onReady) onReady();
  }, []);

  return html`
    <group>
      <${FrameDriver} paused=${paused} onDegrade=${onDegrade} />
      <${CameraRig} paused=${paused} />
      <${Ground} />
      <${Track} paused=${paused} />
      <${Rails} paused=${paused} />
      <${Haze} />
      <${Runner} paused=${paused} />
    </group>
  `;
}

/* ------------------------------- 错误边界 ------------------------------- */

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    if (this.props.onError) this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------- 挂载入口 ------------------------------- */

function dprRange() {
  // 手机 / 小屏降采样，避免高 dpr 设备的填充率爆炸
  return lowPower ? [1, 1.5] : [1, 1.9];
}

function glOptions() {
  return {
    antialias: !lowPower,
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: lowPower ? 'default' : 'high-performance'
  };
}

export function mountScene(host, options = {}) {
  const paused = { current: false };
  const root = createRoot(host);

  const handleCreated = ({ gl }) => {
    gl.setClearColor(new THREE.Color(COLOR.bg), 1);
    const canvas = gl.domElement;
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        if (options.onError) options.onError(new Error('webgl-context-lost'));
      },
      { once: true }
    );
  };

  const app = html`
    <${Boundary} onError=${options.onError}>
      <${Canvas}
        frameloop="demand"
        dpr=${dprRange()}
        shadows=${false}
        gl=${glOptions()}
        camera=${{ position: [0, 1.5, 6.6], fov: 55, near: 0.1, far: 220 }}
        performance=${{ min: 0.5, max: 1, debounce: 240 }}
        onCreated=${handleCreated}
      >
        <color attach="background" args=${[COLOR.bg]} />
        <fog attach="fog" args=${[COLOR.bg, 22, 118]} />
        <${AdaptiveDpr} pixelated />
        <${Scene} paused=${paused} onReady=${options.onReady} onDegrade=${options.onDegrade} />
      <//>
    <//>
  `;

  try {
    root.render(app);
  } catch (error) {
    if (options.onError) options.onError(error);
  }

  return {
    setPaused(value) {
      paused.current = Boolean(value);
      if (!paused.current && requestFrame) requestFrame();
    },
    destroy() {
      paused.current = true;
      try {
        root.unmount();
      } catch (error) {
        /* React 卸载异常时交给宿主清空 DOM */
      }
      requestFrame = null;
    }
  };
}
