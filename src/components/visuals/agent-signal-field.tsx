import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  varying vec2 vUv;

  float line(float value, float width) {
    return 1.0 - smoothstep(0.0, width, abs(value));
  }

  void main() {
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 p = (vUv - 0.5) * aspect;
    vec2 pointer = (uPointer - 0.5) * aspect;
    float time = uTime * 0.12;

    float field = sin((p.x + time) * 5.0);
    field += sin((p.y - time * 0.72) * 7.0) * 0.58;
    field += sin((p.x + p.y + time * 0.45) * 10.0) * 0.22;
    field += 0.18 / (0.12 + distance(p, pointer));

    float contours = line(fract(field * 0.32) - 0.5, 0.075);
    vec2 gridUv = fract(vUv * vec2(24.0, 18.0));
    float grid = max(line(gridUv.x - 0.5, 0.025), line(gridUv.y - 0.5, 0.025));
    float focus = smoothstep(0.95, 0.05, distance(p, pointer));

    vec3 navy = vec3(0.025, 0.075, 0.105);
    vec3 teal = vec3(0.18, 0.76, 0.66);
    vec3 cyan = vec3(0.32, 0.62, 0.72);
    vec3 color = mix(navy, teal, contours * (0.34 + focus * 0.28));
    color += cyan * grid * 0.055;

    float vignette = smoothstep(1.05, 0.12, length(p));
    float alpha = (0.28 + contours * 0.42 + grid * 0.06) * vignette;
    gl_FragColor = vec4(color, alpha);
  }
`

export function AgentSignalField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
    } catch {
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.Camera()
    const geometry = new THREE.PlaneGeometry(2, 2)
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPointer: { value: new THREE.Vector2(0.62, 0.38) },
    }
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const pixelRatio = Math.min(window.devicePixelRatio, 1.5)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const updatePointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      uniforms.uPointer.value.set(
        (event.clientX - bounds.left) / bounds.width,
        1 - (event.clientY - bounds.top) / bounds.height,
      )
    }
    window.addEventListener('pointermove', updatePointer, { passive: true })

    const clock = new THREE.Clock()
    let animationFrame = 0
    const render = () => {
      uniforms.uTime.value = clock.getElapsedTime()
      renderer.render(scene, camera)
      animationFrame = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('pointermove', updatePointer)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
}
