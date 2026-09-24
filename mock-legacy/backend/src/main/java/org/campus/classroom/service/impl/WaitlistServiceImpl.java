package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.dto.SeatReservationCreateDTO;
import org.campus.classroom.dto.WaitlistCreateDTO;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.entity.User;
import org.campus.classroom.entity.WaitlistEntry;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
import org.campus.classroom.event.SeatReservationReleasedEvent;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.MaintenanceWindowMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.mapper.WaitlistEntryMapper;
import org.campus.classroom.service.NotificationService;
import org.campus.classroom.service.ReservationService;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.service.WaitlistService;
import org.campus.classroom.vo.WaitlistEntryVO;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class WaitlistServiceImpl implements WaitlistService {
    private final WaitlistEntryMapper waitlistEntryMapper;
    private final SeatMapper seatMapper;
    private final ClassroomMapper classroomMapper;
    private final ReservationMapper reservationMapper;
    private final MaintenanceWindowMapper maintenanceWindowMapper;
    private final UserMapper userMapper;
    private final ReservationService reservationService;
    private final NotificationService notificationService;
    private final SystemConfigService systemConfigService;

    @Override
    @Transactional
    public Long createSeatWaitlist(Long currentUserId, WaitlistCreateDTO request) {
        waitlistEntryMapper.expireWaitingEntries(utcNow());

        User currentUser = getStudentUser(currentUserId);
        OffsetDateTime startTime = request.getStartTime();
        OffsetDateTime endTime = request.getEndTime();
        LocalDateTime utcStartTime = toUtcLocalDateTime(startTime);
        LocalDateTime utcEndTime = toUtcLocalDateTime(endTime);

        validateBasicTime(startTime, endTime);
        validateDurationTime(currentUser, startTime, endTime);
        validateSeatReservationAdvanceTime(currentUser, startTime);

        Seat seat = seatMapper.selectById(request.getSeatId());
        if (seat == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "座位不存在");
        }
        if (SeatStatus.DISABLED.name().equals(seat.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "座位不可用");
        }

        Classroom classroom = classroomMapper.selectById(seat.getClassroomId());
        if (classroom == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
        }
        if (!ClassroomStatus.ENABLED.name().equals(classroom.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
        }

        if (!maintenanceWindowMapper.selectSeatConflictsForUpdate(request.getSeatId(), utcStartTime, utcEndTime).isEmpty()
                || !maintenanceWindowMapper.selectClassroomConflictsForUpdate(classroom.getId(), utcStartTime, utcEndTime).isEmpty()) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段资源正在维护，无法加入候补");
        }

        if (reservationMapper.selectStudentTimeConflictForUpdate(currentUserId, utcStartTime, utcEndTime) > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "当前时间段您已有其他预约，无法加入候补");
        }

        if (!hasQuotaCapacity(currentUser, startTime, endTime)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "已超过当前信用等级对应的当日预约时长上限");
        }

        if (waitlistEntryMapper.countWaitingDuplicate(currentUserId, request.getSeatId(), utcStartTime, utcEndTime) > 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "相同时间段的候补申请已存在，请勿重复提交");
        }

        boolean seatConflict = reservationMapper.countActiveSeatConflict(request.getSeatId(), utcStartTime, utcEndTime) > 0;
        boolean classroomConflict = reservationMapper.countClassroomConflicts(classroom.getId(), utcStartTime, utcEndTime) > 0;
        if (!seatConflict && !classroomConflict) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "当前时间段资源已可预约，请直接提交预约");
        }

        WaitlistEntry waitlistEntry = new WaitlistEntry();
        waitlistEntry.setUserId(currentUserId);
        waitlistEntry.setSeatId(request.getSeatId());
        waitlistEntry.setClassroomId(classroom.getId());
        waitlistEntry.setStartTime(utcStartTime);
        waitlistEntry.setEndTime(utcEndTime);
        waitlistEntry.setReason(request.getReason());
        waitlistEntry.setStatus("WAITING");
        waitlistEntryMapper.insert(waitlistEntry);
        return waitlistEntry.getId();
    }

    @Override
    public List<WaitlistEntryVO> listCurrentUserWaitlists(Long currentUserId) {
        waitlistEntryMapper.expireWaitingEntries(utcNow());
        return buildWaitlistVOList(waitlistEntryMapper.selectByUserId(currentUserId));
    }

    @Override
    @Transactional
    public void cancelWaitlist(Long currentUserId, Long waitlistId) {
        WaitlistEntry waitlistEntry = waitlistEntryMapper.selectByIdAndUserId(waitlistId, currentUserId);
        if (waitlistEntry == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "候补申请不存在");
        }
        if (!"WAITING".equals(waitlistEntry.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "当前候补申请无法取消");
        }
        if (waitlistEntryMapper.cancelByIdAndUserId(waitlistId, currentUserId) != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "候补状态已变化，请刷新后重试");
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleSeatReservationReleased(SeatReservationReleasedEvent event) {
        try {
            processReleasedSeatWaitlists(event.seatId(), event.startTime(), event.endTime());
        } catch (Exception e) {
            log.error("[候补补位失败] seatId={}, startTime={}, endTime={}",
                    event.seatId(), event.startTime(), event.endTime(), e);
        }
    }

    public void processReleasedSeatWaitlists(Long seatId, LocalDateTime releasedStartTime, LocalDateTime releasedEndTime) {
        waitlistEntryMapper.expireWaitingEntries(utcNow());

        List<WaitlistEntry> candidates = waitlistEntryMapper.selectWaitingCandidatesForSeat(
                seatId,
                releasedStartTime,
                releasedEndTime
        );
        for (WaitlistEntry candidate : candidates) {
            if (!candidate.getStartTime().isAfter(utcNow())) {
                waitlistEntryMapper.markExpired(candidate.getId());
                continue;
            }
            tryPromoteCandidate(candidate);
        }
    }

    private void tryPromoteCandidate(WaitlistEntry candidate) {
        SeatReservationCreateDTO request = new SeatReservationCreateDTO();
        request.setSeatId(candidate.getSeatId());
        request.setStartTime(candidate.getStartTime().atOffset(ZoneOffset.UTC));
        request.setEndTime(candidate.getEndTime().atOffset(ZoneOffset.UTC));
        request.setReason(candidate.getReason());

        try {
            Long reservationId = reservationService.createSeatReservation(candidate.getUserId(), request);
            if (waitlistEntryMapper.markPromoted(candidate.getId(), reservationId) == 1) {
                notificationService.createSystemNotification(
                        candidate.getUserId(),
                        "WAITLIST_PROMOTED",
                        "候补已自动补位成功",
                        buildPromotionNotice(candidate)
                );
            }
        } catch (BusinessException e) {
            if (!candidate.getStartTime().isAfter(utcNow())) {
                waitlistEntryMapper.markExpired(candidate.getId());
            }
            log.info("[候补补位跳过] waitlistId={}, userId={}, reason={}",
                    candidate.getId(), candidate.getUserId(), e.getMessage());
        }
    }

    private List<WaitlistEntryVO> buildWaitlistVOList(List<WaitlistEntry> waitlistEntries) {
        Set<Long> classroomIds = waitlistEntries.stream()
                .map(WaitlistEntry::getClassroomId)
                .collect(Collectors.toSet());
        Set<Long> seatIds = waitlistEntries.stream()
                .map(WaitlistEntry::getSeatId)
                .collect(Collectors.toSet());

        Map<Long, Classroom> classroomMap = classroomIds.isEmpty()
                ? Collections.emptyMap()
                : classroomMapper.selectByIds(classroomIds).stream()
                .collect(Collectors.toMap(Classroom::getId, Function.identity()));
        Map<Long, Seat> seatMap = seatIds.isEmpty()
                ? Collections.emptyMap()
                : seatMapper.selectByIds(seatIds).stream()
                .collect(Collectors.toMap(Seat::getId, Function.identity()));

        return waitlistEntries.stream()
                .map(waitlistEntry -> toWaitlistVO(waitlistEntry, classroomMap, seatMap))
                .toList();
    }

    private WaitlistEntryVO toWaitlistVO(WaitlistEntry waitlistEntry,
                                         Map<Long, Classroom> classroomMap,
                                         Map<Long, Seat> seatMap) {
        WaitlistEntryVO waitlistEntryVO = new WaitlistEntryVO();
        BeanUtils.copyProperties(waitlistEntry, waitlistEntryVO);

        Classroom classroom = classroomMap.get(waitlistEntry.getClassroomId());
        Seat seat = seatMap.get(waitlistEntry.getSeatId());
        if (classroom != null) {
            String seatNumber = seat != null ? seat.getSeatNumber() : "";
            waitlistEntryVO.setResourceName(
                    classroom.getBuilding() + " " + classroom.getRoomNumber() + (seatNumber.isBlank() ? "" : " " + seatNumber)
            );
        }
        return waitlistEntryVO;
    }

    private String buildPromotionNotice(WaitlistEntry candidate) {
        Classroom classroom = classroomMapper.selectById(candidate.getClassroomId());
        Seat seat = seatMapper.selectById(candidate.getSeatId());
        String resourceName;
        if (classroom == null) {
            resourceName = "候补座位";
        } else {
            resourceName = classroom.getBuilding() + " " + classroom.getRoomNumber()
                    + (seat != null ? " " + seat.getSeatNumber() : "");
        }
        return "您候补的 " + resourceName + " 已自动补位成功，请按时前往并完成签到。";
    }

    private User getStudentUser(Long currentUserId) {
        User currentUser = userMapper.selectById(currentUserId);
        if (currentUser == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        if (!"STUDENT".equals(currentUser.getRole())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "仅学生可加入座位候补");
        }
        return currentUser;
    }

    private void validateBasicTime(OffsetDateTime startTime, OffsetDateTime endTime) {
        if (startTime == null || endTime == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "预约时间不能为空");
        }
        if (!endTime.isAfter(startTime)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "结束时间必须晚于开始时间");
        }
        if (startTime.isBefore(OffsetDateTime.now(ZoneOffset.UTC))) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "开始时间必须晚于当前时间");
        }
        if (!toBeijingDate(startTime).equals(toBeijingDate(endTime))) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "预约时间不能跨自然日");
        }
    }

    private void validateDurationTime(User currentUser, OffsetDateTime startTime, OffsetDateTime endTime) {
        long minutes = Duration.between(startTime, endTime).toMinutes();
        int maxSingleReservationMinutes = systemConfigService.getMaxSingleReservationMinutes(currentUser.getCreditScore());
        if (minutes > maxSingleReservationMinutes) {
            throw new BusinessException(
                    ResultCode.BAD_REQUEST,
                    "单次预约时长不能超过" + formatMinutesText(maxSingleReservationMinutes)
            );
        }
    }

    private void validateSeatReservationAdvanceTime(User currentUser, OffsetDateTime startTime) {
        int maxAdvanceHours = systemConfigService.getSeatReservationAdvanceHours(currentUser.getCreditScore());
        OffsetDateTime latestAllowedStartTime = OffsetDateTime.now(ZoneOffset.UTC).plusHours(maxAdvanceHours);
        if (startTime.isAfter(latestAllowedStartTime)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "当前预约时间超出可预约范围，请调整后重试");
        }
    }

    private boolean hasQuotaCapacity(User currentUser, OffsetDateTime startTime, OffsetDateTime endTime) {
        LocalDate date = toBeijingDate(startTime);
        long addMinutes = Duration.between(startTime, endTime).toMinutes();
        long usedMinutes = reservationMapper.selectUsedMinutes(currentUser.getId(), date);
        return usedMinutes + addMinutes <= systemConfigService.getDailyReservationLimitMinutes(currentUser.getCreditScore());
    }

    private LocalDateTime toUtcLocalDateTime(OffsetDateTime dateTime) {
        return dateTime == null ? null : dateTime.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    private LocalDate toBeijingDate(OffsetDateTime dateTime) {
        return dateTime.withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate();
    }

    private LocalDateTime utcNow() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    private String formatMinutesText(int minutes) {
        if (minutes % 60 == 0) {
            return (minutes / 60) + "小时";
        }
        return minutes + "分钟";
    }
}
