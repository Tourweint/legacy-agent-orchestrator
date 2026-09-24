package org.campus.classroom.service;

import org.campus.classroom.vo.NotificationVO;

import java.util.List;

public interface NotificationService {
    void createSystemNotification(Long userId, String type, String title, String content);

    List<NotificationVO> listCurrentUserNotifications(Long userId, Integer limit);

    int countUnread(Long userId);

    void markAllRead(Long userId);
}
