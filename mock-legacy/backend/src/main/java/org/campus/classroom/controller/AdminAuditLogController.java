package org.campus.classroom.controller;

import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.service.AdminAuditService;
import org.campus.classroom.vo.AdminAuditLogVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/admin/audit-logs")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminAuditLogController {
    private final AdminAuditService adminAuditService;

    @GetMapping
    public Result<List<AdminAuditLogVO>> list(@RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) String actionType,
                                              @RequestParam(required = false) String targetType,
                                              @RequestParam(required = false) Integer limit) {
        return Result.success("获取操作日志成功", adminAuditService.list(keyword, actionType, targetType, limit));
    }
}
