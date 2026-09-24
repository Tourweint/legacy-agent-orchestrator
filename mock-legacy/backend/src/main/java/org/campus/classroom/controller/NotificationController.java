package org.campus.classroom.controller;

import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.NotificationService;
import org.campus.classroom.vo.NotificationVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notifications")
@RequiredArgsConstructor
@PreAuthorize("isAuthenticated()")
public class NotificationController {
    private final NotificationService notificationService;

    @GetMapping
    public Result<List<NotificationVO>> list(@RequestParam(defaultValue = "20") Integer limit,
                                             @AuthenticationPrincipal LoginUser loginUser) {
        return Result.success("获取通知成功", notificationService.listCurrentUserNotifications(loginUser.getId(), limit));
    }

    @GetMapping("/unread-count")
    public Result<Map<String, Integer>> unreadCount(@AuthenticationPrincipal LoginUser loginUser) {
        return Result.success("获取未读通知数成功", Map.of("count", notificationService.countUnread(loginUser.getId())));
    }

    @PatchMapping("/read-all")
    public Result<Void> markAllRead(@AuthenticationPrincipal LoginUser loginUser) {
        notificationService.markAllRead(loginUser.getId());
        return Result.success("通知已全部标记为已读");
    }
}
