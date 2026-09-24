package org.campus.classroom.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.service.TokenService;
import org.campus.classroom.utils.JwtUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Objects;

@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtUtil jwtUtil;
    private final JWTUserDetailsService jwtUserDetailsService;
    private final TokenService tokenService;
    private final Logger log = LoggerFactory.getLogger(this.getClass());

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath();
        return "/auth/login".equals(path)
                || "/auth/login/code".equals(path)
                || "/auth/email-code".equals(path)
                || "/auth/register".equals(path)
                || "/auth/password/reset".equals(path)
                || "/auth/logout".equals(path)
                || "/auth/refresh".equals(path);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain)
            throws ServletException, IOException {
        String authHeader = request.getHeader("Authorization");

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.debug("认证过滤器: 未携带 Bearer 令牌，跳过令牌认证");
            filterChain.doFilter(request, response);
            return;
        }

        if (SecurityContextHolder.getContext().getAuthentication() != null) {
            log.debug("认证过滤器: 已存在认证信息，直接放行");
            filterChain.doFilter(request, response);
            return;
        }

        try {
            String token = authHeader.substring(7);
            Claims claims = jwtUtil.parseToken(token);
            String username = claims.get("username", String.class);
            Integer tokenVersion = claims.get("tokenVersion", Integer.class);
            String deviceId = claims.get("deviceId", String.class);

            if (username == null || tokenVersion == null || deviceId == null) {
                returnUnauthorizedResponse(response);
                return;
            }

            LoginUser loginUser = (LoginUser) jwtUserDetailsService.loadUserByUsername(username);
            Long tokenUserId = Long.valueOf(claims.getSubject());
            if (!Objects.equals(tokenUserId, loginUser.getId())
                    || !Objects.equals(tokenVersion, loginUser.getTokenVersion())
                    || !tokenService.isDeviceSessionActive(tokenUserId, deviceId)) {
                returnUnauthorizedResponse(response);
                return;
            }

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(loginUser, null, loginUser.getAuthorities());
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (Exception e) {
            log.debug("认证过滤器: 令牌解析失败, message={}", e.getMessage());
            returnUnauthorizedResponse(response);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private void returnUnauthorizedResponse(HttpServletResponse response) throws IOException {
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        new ObjectMapper().writeValue(response.getWriter(), Result.fail(ResultCode.UNAUTHORIZED));
    }
}
