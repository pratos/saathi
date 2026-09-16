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
  float t = u_time;
  float energy = mix(0.18, 1.0, clamp(u_level, 0.0, 1.0));
  float breathe = 0.94 + 0.06 * sin(t * 0.7);

  vec2 c0 = vec2(0.0, 0.02) + 0.025 * vec2(cos(t * 0.21), sin(t * 0.17));
  vec2 c1 = vec2(sin(t * 0.55), cos(t * 0.41)) * (0.09 + 0.07 * energy);
  vec2 c2 = vec2(cos(t * 0.37 + 1.3), sin(t * 0.63 + 0.4)) * (0.11 + 0.05 * energy);
  vec2 c3 = vec2(sin(t * 0.49 + 2.2), cos(t * 0.33 + 1.1)) * 0.10;

  float f = field(uv, c0, 0.33 * breathe)
    + field(uv, c1, 0.19 + 0.06 * energy)
    + field(uv, c2, 0.16 + 0.05 * energy)
    + field(uv, c3, 0.13);

  float body = smoothstep(0.96, 1.34, f);
  float halo = max(smoothstep(0.38, 1.08, f) - body, 0.0);
  float rim = smoothstep(1.02, 1.22, f) * (1.0 - smoothstep(1.28, 1.62, f));
  float highlight = exp(-length(uv - vec2(-0.10, 0.18)) * 6.8) * body;
  float caustic = 0.5 + 0.5 * sin((uv.x * 9.0 + uv.y * 7.0) + t * 1.3);
  caustic *= 0.5 + 0.5 * sin((uv.y * 11.0 - uv.x * 5.0) - t * 0.9);

  vec3 deep = vec3(0.06, 0.14, 0.14);
  vec3 aqua = vec3(0.52, 0.90, 0.84);
  vec3 gold = vec3(0.95, 0.76, 0.38);
  vec3 lilac = vec3(0.64, 0.50, 0.92);
  vec3 mist = vec3(0.90, 0.98, 0.96);

  float angle = atan(uv.y, uv.x);
  vec3 iridescence = mix(aqua, lilac, 0.5 + 0.5 * sin(angle * 1.8 + t * 0.45));
  iridescence = mix(iridescence, gold, 0.28 + 0.28 * sin(angle * 1.15 - t * 0.32));

  vec3 color = mix(deep, iridescence, body);
  color = mix(color, gold, rim * 0.65);
  color += mist * highlight * 0.62;
  color += aqua * halo * (0.22 + 0.18 * energy);
  color += gold * body * caustic * 0.08 * energy;

  if (u_muted > 0.5) {
    color = mix(color, vec3(0.80, 0.62, 0.54), 0.26);
  }

  float alpha = clamp(body * 0.98 + halo * 0.48 + rim * 0.22, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
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
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false })
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
      const size = Math.max(1, Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)))
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
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
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
      <i className="voice-blob-glow" />
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
