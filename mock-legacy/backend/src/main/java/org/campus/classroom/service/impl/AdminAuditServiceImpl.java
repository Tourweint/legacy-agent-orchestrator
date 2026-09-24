package org.campus.classroom.service.impl;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.entity.AdminAuditLog;
import org.campus.classroom.mapper.AdminAuditLogMapper;
import org.campus.classroom.service.AdminAuditService;
import org.campus.classroom.vo.AdminAuditLogVO;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.List;

@Service
@RequiredArgsConstructor
public class AdminAuditServiceImpl implements AdminAuditService {
    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 500;

    private final AdminAuditLogMapper adminAuditLogMapper;

    @Override
    public void log(Long adminUserId,
                    String adminUsername,
                    String actionType,
                    String targetType,
                    Long targetId,
                    String targetName,
                    String detail) {
        if (adminUserId == null || !StringUtils.hasText(adminUsername)
                || !StringUtils.hasText(actionType) || !StringUtils.hasText(targetType)) {
            return;
        }

        AdminAuditLog auditLog = new AdminAuditLog();
        auditLog.setAdminUserId(adminUserId);
        auditLog.setAdminUsername(adminUsername.trim());
        auditLog.setActionType(actionType.trim());
        auditLog.setTargetType(targetType.trim());
        auditLog.setTargetId(targetId);
        auditLog.setTargetName(trimToNull(targetName));
        auditLog.setDetail(trimToNull(detail));
        auditLog.setIp(resolveRequestIp());
        adminAuditLogMapper.insert(auditLog);
    }

    @Override
    public List<AdminAuditLogVO> list(String keyword, String actionType, String targetType, Integer limit) {
        return adminAuditLogMapper.selectList(
                        trimToNull(keyword),
                        trimToNull(actionType),
                        trimToNull(targetType),
                        normalizeLimit(limit)
                ).stream()
                .map(this::toVO)
                .toList();
    }

    private AdminAuditLogVO toVO(AdminAuditLog auditLog) {
        AdminAuditLogVO vo = new AdminAuditLogVO();
        BeanUtils.copyProperties(auditLog, vo);
        return vo;
    }

    private Integer normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private String trimToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private String resolveRequestIp() {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes == null) {
            return null;
        }
        HttpServletRequest request = attributes.getRequest();
        if (request == null) {
            return null;
        }
        String forwarded = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(forwarded)) {
            return forwarded.split(",")[0].trim();
        }
        String realIp = request.getHeader("X-Real-IP");
        if (StringUtils.hasText(realIp)) {
            return realIp.trim();
        }
        return request.getRemoteAddr();
    }
}
