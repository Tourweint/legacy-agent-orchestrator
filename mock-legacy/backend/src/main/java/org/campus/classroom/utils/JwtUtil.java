package org.campus.classroom.utils;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.campus.classroom.security.DeviceContext;
import org.campus.classroom.security.LoginUser;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class JwtUtil {
    private final SecretKey key;
    private final long accessExpiration;

    public JwtUtil(@Value("${jwt.secret}") String secretKey,
                   @Value("${jwt.access-expiration}") long expirationTime) {
        this.key = Keys.hmacShaKeyFor(secretKey.getBytes(StandardCharsets.UTF_8));
        this.accessExpiration = expirationTime;
    }

    public String generateToken(Long userId) {
        Date now = new Date();
        Date expireDate = new Date(now.getTime() + accessExpiration);

        return Jwts.builder()
                .header().add("alg", "HS256").add("typ", "JWT").and()
                .subject(String.valueOf(userId))
                .issuedAt(now)
                .expiration(expireDate)
                .signWith(key)
                .compact();
    }

    public String generateToken(LoginUser user, DeviceContext deviceContext) {
        Date now = new Date();
        Date expireDate = new Date(now.getTime() + accessExpiration);
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("username", user.getUsername());
        claims.put("role", user.getRole());
        claims.put("tokenVersion", user.getTokenVersion());
        claims.put("deviceId", deviceContext.deviceId());

        return Jwts.builder()
                .header().add("alg", "HS256").add("typ", "JWT").and()
                .subject(String.valueOf(user.getId()))
                .claims(claims)
                .issuedAt(now)
                .expiration(expireDate)
                .signWith(key)
                .compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isTokenValid(String token) {
        try {
            parseToken(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}
