package org.campus.classroom.service;

import org.campus.classroom.vo.AdminAnalyticsVO;
import org.campus.classroom.vo.AdminReservationVO;
import org.campus.classroom.vo.AdminUserVO;

import java.util.List;

public interface AdminService {
    List<AdminUserVO> listUsers(String keyword, String role, Integer status);

    AdminUserVO updateUserStatus(Long adminUserId, Long targetUserId, Integer status, String reason);

    AdminUserVO forceLogoutUser(Long adminUserId, Long targetUserId, String reason);

    List<AdminReservationVO> listReservations(String keyword, String status);

    void cancelReservation(Long adminUserId, Long reservationId, String reason);

    AdminAnalyticsVO getAnalytics(Integer days);
}
