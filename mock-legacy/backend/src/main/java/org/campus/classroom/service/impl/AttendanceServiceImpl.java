package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.entity.AttendanceRecord;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.entity.User;
import org.campus.classroom.entity.ViolationRecord;
import org.campus.classroom.enums.AttendanceStatus;
import org.campus.classroom.enums.ReservationStatus;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.ViolationType;
import org.campus.classroom.event.SeatReservationReleasedEvent;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.AttendanceMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.mapper.ViolationRecordMapper;
import org.campus.classroom.service.AttendanceService;
import org.campus.classroom.service.NotificationService;
import org.campus.classroom.service.SystemConfigService;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class AttendanceServiceImpl implements AttendanceService {
    private final ReservationMapper reservationMapper;
    private final AttendanceMapper attendanceMapper;
    private final ViolationRecordMapper violationRecordMapper;
    private final UserMapper userMapper;
    private final NotificationService notificationService;
    private final SystemConfigService systemConfigService;
    private final ApplicationEventPublisher applicationEventPublisher;

    @Override
    @Transactional
    public Boolean checkIn(Long currentUserId, Long reservationId) {
        User currentUser = userMapper.selectById(currentUserId);
        if (currentUser == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        if (!"STUDENT".equals(currentUser.getRole())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "仅学生预约需要签到");
        }

        Reservation reservation = reservationMapper.selectByReservationIdAndUserIdForUpdate(reservationId, currentUserId);
        if (reservation == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "预约记录不存在");
        }
        if (!ReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "只有进行中的预约才能签到");
        }

        LocalDateTime now = utcNow();
        int checkInEarlyMinutes = systemConfigService.getCheckInEarlyMinutes();
        int checkInGraceMinutes = systemConfigService.getCheckInGraceMinutes();
        LocalDateTime earliestCheckInTime = reservation.getStartTime().minusMinutes(checkInEarlyMinutes);
        LocalDateTime latestCheckInTime = reservation.getStartTime().plusMinutes(checkInGraceMinutes);
        if (now.isBefore(earliestCheckInTime) || now.isAfter(latestCheckInTime)) {
            throw new BusinessException(
                    ResultCode.BAD_REQUEST,
                    "仅可在预约开始前" + checkInEarlyMinutes + "分钟到开始后" + checkInGraceMinutes + "分钟内签到"
            );
        }

        attendanceMapper.insertStatusIfAbsent(reservationId, AttendanceStatus.PENDING.name());
        AttendanceRecord attendanceRecord = attendanceMapper.selectByReservationIdForUpdate(reservationId);
        if (attendanceRecord == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "签到记录不存在");
        }
        if (AttendanceStatus.CHECKED_IN.name().equals(attendanceRecord.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该预约已完成签到");
        }
        if (AttendanceStatus.NO_SHOW.name().equals(attendanceRecord.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该预约已被标记为爽约");
        }
        if (AttendanceStatus.CANCELLED.name().equals(attendanceRecord.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该预约的签到已关闭");
        }

        int updatedRows = attendanceMapper.updateToCheckedIn(reservationId, now);
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "签到状态已变化，请刷新后重试");
        }

        rewardAfterSuccessfulCheckIn(currentUserId);
        return true;
    }

    @Override
    @Transactional
    public int markNoShows() {
        LocalDateTime latestAllowedCheckIn = utcNow().minusMinutes(systemConfigService.getCheckInGraceMinutes());
        List<Reservation> reservations = reservationMapper.selectReservationsDueForNoShow(latestAllowedCheckIn);
        int count = 0;
        for (Reservation reservation : reservations) {
            if (markSingleNoShow(reservation.getId())) {
                count++;
            }
        }
        return count;
    }

    @Override
    @Transactional
    public void markCancelledIfPending(Long reservationId) {
        attendanceMapper.insertStatusIfAbsent(reservationId, AttendanceStatus.CANCELLED.name());
        attendanceMapper.updateStatusIfPending(reservationId, AttendanceStatus.CANCELLED.name());
    }

    @Override
    @Transactional
    public int recoverCreditScoreDaily() {
        return userMapper.recoverCreditScoreDaily(
                systemConfigService.getDailyRecoveryScore(),
                systemConfigService.getCreditMinScore(),
                systemConfigService.getCreditMaxScore()
        );
    }

    private boolean markSingleNoShow(Long reservationId) {
        Reservation reservation = reservationMapper.selectByIdForUpdate(reservationId);
        if (reservation == null || !ReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            return false;
        }

        LocalDateTime now = utcNow();
        if (now.isBefore(reservation.getStartTime().plusMinutes(systemConfigService.getCheckInGraceMinutes()))) {
            return false;
        }

        attendanceMapper.insertStatusIfAbsent(reservationId, AttendanceStatus.PENDING.name());
        AttendanceRecord attendanceRecord = attendanceMapper.selectByReservationIdForUpdate(reservationId);
        if (attendanceRecord == null || !AttendanceStatus.PENDING.name().equals(attendanceRecord.getStatus())) {
            return false;
        }

        int attendanceRows = attendanceMapper.updateStatusIfPending(reservationId, AttendanceStatus.NO_SHOW.name());
        if (attendanceRows != 1) {
            return false;
        }

        int cancelRows = reservationMapper.noShowCancelReservation(reservationId);
        if (cancelRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "预约状态已变化，请重试");
        }

        long minusMinutes = Duration.between(reservation.getStartTime(), reservation.getEndTime()).toMinutes();
        int usageRows = reservationMapper.minusUsage(reservation.getUserId(), reservation.getReserveDate(), minusMinutes);
        if (usageRows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "爽约回滚预约配额失败");
        }

        if (userMapper.selectById(reservation.getUserId()) != null) {
            decreaseCreditScore(reservation.getUserId(), systemConfigService.getNoShowDeductionScore());
        }

        ViolationRecord violationRecord = new ViolationRecord();
        violationRecord.setUserId(reservation.getUserId());
        violationRecord.setReservationId(reservationId);
        violationRecord.setType(ViolationType.NO_SHOW.name());
        violationRecord.setRemark(buildNoShowRemark());
        violationRecordMapper.insert(violationRecord);

        notificationService.createSystemNotification(
                reservation.getUserId(),
                "RESERVATION_NO_SHOW",
                "预约已按爽约处理",
                buildNoShowNotice()
        );
        applicationEventPublisher.publishEvent(new SeatReservationReleasedEvent(
                reservation.getResourceId(),
                reservation.getStartTime(),
                reservation.getEndTime()
        ));
        return true;
    }

    private String buildNoShowRemark() {
        return "预约开始后" + systemConfigService.getCheckInGraceMinutes()
                + "分钟内未完成签到，系统已自动取消本次预约并记录异常，后续预约将受到影响。";
    }

    private String buildNoShowNotice() {
        return "您的预约在开始后" + systemConfigService.getCheckInGraceMinutes()
                + "分钟内未完成签到，系统已自动取消本次预约并记录异常，后续预约将受到影响。";
    }

    private void rewardAfterSuccessfulCheckIn(Long userId) {
        if (userMapper.selectById(userId) == null) {
            return;
        }

        int checkInRewardScore = systemConfigService.getCheckInRewardScore();
        if (checkInRewardScore > 0) {
            increaseCreditScore(userId, checkInRewardScore);
        }

        int successStreakSize = systemConfigService.getSuccessStreakSize();
        int successStreakReward = systemConfigService.getSuccessStreakRewardScore();
        if (successStreakSize <= 0 || successStreakReward <= 0) {
            return;
        }

        int streakCount = getRecentSuccessStreakCount(userId);
        if (streakCount >= successStreakSize && streakCount % successStreakSize == 0) {
            increaseCreditScore(userId, successStreakReward);
        }
    }

    private int getRecentSuccessStreakCount(Long userId) {
        List<Reservation> reservations = reservationMapper.selectByUserId(userId);
        if (reservations.isEmpty()) {
            return 0;
        }

        Map<Long, AttendanceRecord> attendanceMap = attendanceMapper.selectByReservationIds(
                reservations.stream().map(Reservation::getId).toList()
        ).stream().collect(Collectors.toMap(AttendanceRecord::getReservationId, Function.identity()));

        int streak = 0;
        for (Reservation reservation : reservations) {
            AttendanceRecord attendanceRecord = attendanceMap.get(reservation.getId());
            if (attendanceRecord == null) {
                continue;
            }
            if (AttendanceStatus.CHECKED_IN.name().equals(attendanceRecord.getStatus())) {
                streak++;
                continue;
            }
            break;
        }
        return streak;
    }

    private void decreaseCreditScore(Long userId, int delta) {
        int updatedRows = userMapper.decreaseCreditScore(
                userId,
                delta,
                systemConfigService.getCreditMinScore(),
                systemConfigService.getCreditMaxScore()
        );
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "更新用户信用信息失败");
        }
    }

    private void increaseCreditScore(Long userId, int delta) {
        int updatedRows = userMapper.increaseCreditScore(
                userId,
                delta,
                systemConfigService.getCreditMinScore(),
                systemConfigService.getCreditMaxScore()
        );
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "更新用户信用信息失败");
        }
    }

    private LocalDateTime utcNow() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }
}
