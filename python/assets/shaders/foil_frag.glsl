#version 330 core

in vec2 v_uv;
out vec4 frag_color;

uniform sampler2D u_texture;
uniform vec2 u_glare_pos;      // [0, 1] normalized mouse position
uniform float u_glare_opacity; // [0, 1]
uniform float u_time;

void main() {
    vec4 base = texture(u_texture, v_uv);

    // Diagonal holographic foil stripe angle
    float angle = v_uv.x * 0.707 + v_uv.y * 0.707;
    vec3 foil_tint = vec3(
        0.5 + 0.5 * sin(angle * 12.0 + u_time + u_glare_pos.x * 6.28),
        0.5 + 0.5 * sin(angle * 12.0 + u_time + u_glare_pos.y * 6.28 + 2.09),
        0.5 + 0.5 * sin(angle * 12.0 + u_time + 4.18)
    );

    // Specular glare hotspot
    float dist = distance(v_uv, u_glare_pos);
    float glare = smoothstep(0.45, 0.0, dist) * u_glare_opacity;

    vec3 blended = mix(base.rgb, base.rgb + foil_tint * 0.45, 0.5) + vec3(glare * 0.6);
    frag_color = vec4(blended, base.a);
}
