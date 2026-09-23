import { useEffect, useRef } from 'react'

const VERTEX = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform float u_muted;

float field(vec2 p, vec2 c, float r) {
  vec2 d = p - c;
  return (r * r) / max(dot(d, d), 0.0008);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  uv *= 1.14;
  float t = u_time;
  float energy = mix(0.18, 1.0, clamp(u_level, 0.0, 1.0));
  float breathe = 0.94 + 0.06 * sin(t * 0.7);

  vec2 c0 = vec2(-0.025, 0.02) + 0.025 * vec2(cos(t * 0.21), sin(t * 0.17));
  vec2 c1 = vec2(sin(t * 0.55), cos(t * 0.41)) * (0.14 + 0.09 * energy);
  vec2 c2 = vec2(cos(t * 0.37 + 1.3), sin(t * 0.63 + 0.4)) * (0.16 + 0.07 * energy);
  vec2 c3 = vec2(sin(t * 0.49 + 2.2), cos(t * 0.33 + 1.1)) * 0.14;

  float f = field(uv, c0, 0.28 * breathe)
    + field(uv, c1, 0.21 + 0.07 * energy)
    + field(uv, c2, 0.18 + 0.06 * energy)
    + field(uv, c3, 0.16);

  float angle = atan(uv.y, uv.x);
  float organic = 0.15 * sin(angle * 3.0 + t * 0.24) + 0.07 * sin(angle * 5.0 - t * 0.18);
  float surface = 1.10 + organic;
  float pixel = 3.0 / min(u_res.x, u_res.y);
  float body = smoothstep(surface - pixel, surface + pixel, f);
  float rim = body * (1.0 - smoothstep(surface + 0.10, surface + 0.78, f));
  float depth = smoothstep(surface + 0.18, 3.5, f);
  float highlight = exp(-length(uv - vec2(-0.13, 0.17)) * 7.6) * body;
  float drift = 0.5 + 0.5 * sin(uv.x * 3.2 - uv.y * 2.7 + t * 0.34);

  vec3 pearl = vec3(0.91, 0.93, 0.99);
  vec3 sky = vec3(0.48, 0.73, 0.94);
  vec3 lilac = vec3(0.61, 0.51, 0.91);
  vec3 blush = vec3(0.96, 0.58, 0.71);

  float softCore = clamp(depth * 0.80 + drift * 0.04 * energy, 0.0, 1.0);
  vec3 color = mix(pearl, lilac, rim * (0.80 + 0.10 * energy));
  color = mix(color, pearl, softCore * 0.72);
  float cyanEdge = rim * smoothstep(-0.36, 0.32, uv.y - uv.x);
  float roseEdge = rim * smoothstep(-0.08, 0.42, -uv.y - uv.x * 0.35);
  color += sky * cyanEdge * (0.18 + 0.07 * energy);
  color += blush * roseEdge * (0.10 + 0.04 * energy);
  color += vec3(1.0, 0.99, 1.0) * highlight * 0.24;

  if (u_muted > 0.5) {
    color = mix(color, vec3(0.73, 0.71, 0.82), 0.30);
  }

  float canvasEdge = 1.0 - smoothstep(0.51, 0.565, max(abs(uv.x), abs(uv.y)));
  float alpha = body * canvasEdge;
  gl_FragColor = vec4(color * alpha, alpha);
}`

export function VoiceBlob({ level, muted }: { level: number; muted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const levelRef = useRef(level)
  const mutedRef = useRef(muted)

  useEffect(() => {
    levelRef.current = level
    mutedRef.current = muted
  }, [level, muted])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
    if (!gl) return

    const program = compile(gl)
    if (!program) return
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(program, 'u_res')
    const uTime = gl.getUniformLocation(program, 'u_time')
    const uLevel = gl.getUniformLocation(program, 'u_level')
    const uMuted = gl.getUniformLocation(program, 'u_muted')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    let frame = 0
    let disposed = false
    let displayedLevel = 0

    const resize = () => {
      const pixelRatio = Math.min(4, Math.max(2, window.devicePixelRatio * 2))
      const size = Math.max(1, Math.round(canvas.clientWidth * pixelRatio))
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size
        canvas.height = size
        gl.viewport(0, 0, size, size)
      }
    }

    const draw = (now: number) => {
      if (disposed) return
      resize()
      displayedLevel += (levelRef.current - displayedLevel) * 0.12
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, reduced ? 0 : (now - started) / 1000)
      gl.uniform1f(uLevel, displayedLevel)
      gl.uniform1f(uMuted, mutedRef.current ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      stageRef.current?.classList.add('is-ready')
      if (!reduced) frame = requestAnimationFrame(draw)
    }

    draw(performance.now())
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [])

  return (
    <div ref={stageRef} className={`voice-blob ${muted ? 'is-muted' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

function compile(gl: WebGLRenderingContext) {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const compiled = gl.createShader(type)
  if (!compiled) return null
  gl.shaderSource(compiled, source)
  gl.compileShader(compiled)
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
    gl.deleteShader(compiled)
    return null
  }
  return compiled
}
