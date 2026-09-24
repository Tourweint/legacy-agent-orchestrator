package org.campus.classroom.controller;

import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.service.AdminService;
import org.campus.classroom.vo.AdminAnalyticsVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/analytics")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminAnalyticsController {
    private final AdminService adminService;

    @GetMapping
    public Result<AdminAnalyticsVO> analytics(@RequestParam(required = false) Integer days) {
        return Result.success("获取统计分析数据成功", adminService.getAnalytics(days));
    }
}
