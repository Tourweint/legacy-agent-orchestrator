package org.campus.classroom.service;

import org.campus.classroom.vo.AdminAuditLogVO;

import java.util.List;

public interface AdminAuditService {
    void log(Long adminUserId,
             String adminUsername,
             String actionType,
             String targetType,
             Long targetId,
             String targetName,
             String detail);

    List<AdminAuditLogVO> list(String keyword, String actionType, String targetType, Integer limit);
}
