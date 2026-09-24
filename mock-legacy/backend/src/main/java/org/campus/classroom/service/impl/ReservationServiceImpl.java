package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.dto.ClassroomReservationCreateDTO;
import org.campus.classroom.dto.SeatReservationCreateDTO;
import org.campus.classroom.entity.AttendanceRecord;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.entity.User;
import org.campus.classroom.entity.ViolationRecord;
import org.campus.classroom.enums.AttendanceStatus;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ReservationStatus;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
import org.campus.classroom.enums.ViolationType;
import org.campus.classroom.event.SeatReservationReleasedEvent;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.AttendanceMapper;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.MaintenanceWindowMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.mapper.ViolationRecordMapper;
import org.campus.classroom.service.ReservationService;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.vo.ReservationVO;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
public class ReservationServiceImpl implements ReservationService {
    private static final ZoneOffset BEIJING_OFFSET = ZoneOffset.ofHours(8);

    private final ReservationMapper reservationMapper;
    private final SeatMapper seatMapper;
    private final ClassroomMapper classroomMapper;
    private final AttendanceMapper attendanceMapper;
    private final UserMapper userMapper;
    private final ViolationRecordMapper violationRecordMapper;
    private final MaintenanceWindowMapper maintenanceWindowMapper;
    private final SystemConfigService systemConfigService;
    private final ApplicationEventPublisher applicationEventPublisher;

    @Override
    @Transactional
    public Long createSeatReservation(Long currentUserId, SeatReservationCreateDTO request) {
        User currentUser = getUserOrThrow(currentUserId);
        OffsetDateTime startTime = request.getStartTime();
        OffsetDateTime endTime = request.getEndTime();
        LocalDateTime utcStartTime = toUtcLocalDateTime(startTime);
        LocalDateTime utcEndTime = toUtcLocalDateTime(endTime);

        validateTime(currentUser, startTime, endTime);
        validateSeatReservationAdvanceTime(currentUser, startTime);
        Long classroomId = checkSeatReservableAndGetClassroomId(currentUserId, request, utcStartTime, utcEndTime);
        tryConsumeDailyUsageQuota(currentUser, startTime, endTime);

        Reservation reservation = buildSeatReservation(currentUserId, request, classroomId, utcStartTime, utcEndTime);
        reservationMapper.insert(reservation);
        attendanceMapper.insertStatusIfAbsent(reservation.getId(), AttendanceStatus.PENDING.name());
        log.info("[创建座位预约成功] userId={}, reservationId={}, seatId={}",
                currentUserId, reservation.getId(), request.getSeatId());
        return reservation.getId();
    }

    @Override
    @Transactional
    public Long createClassroomReservation(Long currentUserId, ClassroomReservationCreateDTO request) {
        User currentUser = getUserOrThrow(currentUserId);
        OffsetDateTime startTime = request.getStartTime();
        OffsetDateTime endTime = request.getEndTime();
        LocalDateTime utcStartTime = toUtcLocalDateTime(startTime);
        LocalDateTime utcEndTime = toUtcLocalDateTime(endTime);

        validateTime(currentUser, startTime, endTime);
        checkClassroomReservable(request, utcStartTime, utcEndTime);
        tryConsumeDailyUsageQuota(currentUser, startTime, endTime);

        Reservation reservation = buildClassroomReservation(currentUserId, request, utcStartTime, utcEndTime);
        reservationMapper.insert(reservation);
        log.info("[创建教室预约成功] userId={}, reservationId={}, classroomId={}",
                currentUserId, reservation.getId(), request.getClassroomId());
        return reservation.getId();
    }

    @Override
    @Transactional
    public Boolean cancelReservation(Long currentUserId, Long reservationId) {
        Reservation reservation = reservationMapper.selectByReservationIdAndUserId(reservationId, currentUserId);
        if (reservation == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "预约记录不存在");
        }
        if (ReservationStatus.CANCELLED.name().equals(reservation.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该预约已取消");
        }
        if (reservation.getEndTime().isBefore(utcNow())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "历史预约不能取消");
        }

        int cancelReservationRows = reservationMapper.cancelReservation(reservationId);
        if (cancelReservationRows != 1) {
            throw new BusinessException(ResultCode.CONFLICT, "预约状态已变化，请刷新后重试");
        }

        long minusMinutes = Duration.between(reservation.getStartTime(), reservation.getEndTime()).toMinutes();
        int minusUsageRows = reservationMapper.minusUsage(reservation.getUserId(), reservation.getReserveDate(), minusMinutes);
        if (minusUsageRows != 1) {
            log.error("[取消预约回滚失败] userId={}, reserveDate={}, minusMinutes={}",
                    reservation.getUserId(), reservation.getReserveDate(), minusMinutes);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "取消预约失败");
        }

        if (ResourceType.SEAT.name().equals(reservation.getResourceType())) {
            attendanceMapper.insertStatusIfAbsent(reservationId, AttendanceStatus.CANCELLED.name());
            attendanceMapper.updateStatusIfPending(reservationId, AttendanceStatus.CANCELLED.name());
        }
        applyCancelCreditPenalty(reservation);
        publishSeatReleaseEventIfNeeded(reservation);
        return true;
    }

    @Override
    public int expireActiveReservations() {
        return reservationMapper.expireActiveReservations();
    }

    @Override
    public List<ReservationVO> listUserAvailableReservations(Long currentUserId) {
        List<Reservation> reservationList = reservationMapper.selectByUserIdAndStatus(
                currentUserId,
                ReservationStatus.ACTIVE.name()
        );
        return buildReservationVOList(reservationList);
    }

    @Override
    public List<ReservationVO> listUserHistoryReservations(Long currentUserId) {
        List<Reservation> reservationList = reservationMapper.selectByUserIdAndNotStatus(
                currentUserId,
                ReservationStatus.ACTIVE.name()
        );
        return buildReservationVOList(reservationList);
    }

    @Override
    public List<Long> listReservedSeatIds(Long currentUserId, Long classroomId, OffsetDateTime startTime, OffsetDateTime endTime) {
        User currentUser = getUserOrThrow(currentUserId);
        LocalDateTime utcStartTime = toUtcLocalDateTime(startTime);
        LocalDateTime utcEndTime = toUtcLocalDateTime(endTime);

        validateTime(currentUser, startTime, endTime);

        Classroom classroom = classroomMapper.selectById(classroomId);
        if (classroom == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
        }
        if (!ClassroomStatus.ENABLED.name().equals(classroom.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
        }

        if (reservationMapper.countClassroomConflicts(classroomId, utcStartTime, utcEndTime) > 0
                || maintenanceWindowMapper.countClassroomConflicts(classroomId, utcStartTime, utcEndTime) > 0) {
            return seatMapper.selectByClassroomId(classroomId)
                    .stream()
                    .map(Seat::getId)
                    .toList();
        }

        List<Long> reservedSeatIds = reservationMapper.selectReservedSeatIdsInClassroom(classroomId, utcStartTime, utcEndTime);
        List<Long> maintainedSeatIds = maintenanceWindowMapper.selectMaintainedSeatIdsInClassroom(
                classroomId,
                utcStartTime,
                utcEndTime
        );
        return java.util.stream.Stream.concat(reservedSeatIds.stream(), maintainedSeatIds.stream())
                .distinct()
                .toList();
    }

    private Reservation buildSeatReservation(Long currentUserId, SeatReservationCreateDTO request, Long classroomId,
                                             LocalDateTime utcStartTime, LocalDateTime utcEndTime) {
        Reservation reservation = new Reservation();
        reservation.setUserId(currentUserId);
        reservation.setResourceType(ResourceType.SEAT.name());
        reservation.setResourceId(request.getSeatId());
        reservation.setClassroomId(classroomId);
        reservation.setReserveDate(toBeijingDate(request.getStartTime()));
        reservation.setStartTime(utcStartTime);
        reservation.setEndTime(utcEndTime);
        reservation.setReason(request.getReason());
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        return reservation;
    }

    private Reservation buildClassroomReservation(Long currentUserId, ClassroomReservationCreateDTO request,
                                                  LocalDateTime utcStartTime, LocalDateTime utcEndTime) {
        Reservation reservation = new Reservation();
        reservation.setUserId(currentUserId);
        reservation.setResourceType(ResourceType.CLASSROOM.name());
        reservation.setResourceId(request.getClassroomId());
        reservation.setClassroomId(request.getClassroomId());
        reservation.setReserveDate(toBeijingDate(request.getStartTime()));
        reservation.setStartTime(utcStartTime);
        reservation.setEndTime(utcEndTime);
        reservation.setReason(request.getReason());
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        return reservation;
    }

    private List<ReservationVO> buildReservationVOList(List<Reservation> reservationList) {
        Set<Long> classroomIds = reservationList.stream()
                .map(Reservation::getClassroomId)
                .collect(Collectors.toSet());

        Set<Long> seatIds = reservationList.stream()
                .filter(reservation -> ResourceType.SEAT.name().equals(reservation.getResourceType()))
                .map(Reservation::getResourceId)
                .collect(Collectors.toSet());

        Map<Long, Classroom> classroomMap = classroomIds.isEmpty()
                ? Collections.emptyMap()
                : classroomMapper.selectByIds(classroomIds).stream()
                .collect(Collectors.toMap(Classroom::getId, Function.identity()));

        Map<Long, Seat> seatMap = seatIds.isEmpty()
                ? Collections.emptyMap()
                : seatMapper.selectByIds(seatIds).stream()
                .collect(Collectors.toMap(Seat::getId, Function.identity()));

        Map<Long, AttendanceRecord> attendanceMap = reservationList.isEmpty()
                ? Collections.emptyMap()
                : attendanceMapper.selectByReservationIds(
                reservationList.stream().map(Reservation::getId).toList()
        ).stream().collect(Collectors.toMap(AttendanceRecord::getReservationId, Function.identity()));

        return reservationList.stream()
                .map(reservation -> reservationToReservationVO(reservation, classroomMap, seatMap, attendanceMap))
                .toList();
    }

    private ReservationVO reservationToReservationVO(Reservation reservation,
                                                     Map<Long, Classroom> classroomMap,
                                                     Map<Long, Seat> seatMap,
                                                     Map<Long, AttendanceRecord> attendanceMap) {
        ReservationVO reservationVO = new ReservationVO();
        BeanUtils.copyProperties(reservation, reservationVO);

        Classroom classroom = classroomMap.get(reservation.getClassroomId());
        if (classroom != null) {
            Seat seat = seatMap.get(reservation.getResourceId());
            reservationVO.setResourceName(
                    classroom.getBuilding() + " " + classroom.getRoomNumber() + (seat != null ? " " + seat.getSeatNumber() : "")
            );
        }

        if (ResourceType.CLASSROOM.name().equals(reservation.getResourceType())) {
            reservationVO.setAttendanceStatus(null);
            reservationVO.setCheckInTime(null);
            reservationVO.setCanCheckIn(false);
            return reservationVO;
        }

        AttendanceRecord attendanceRecord = attendanceMap.get(reservation.getId());
        String attendanceStatus = attendanceRecord != null
                ? attendanceRecord.getStatus()
                : ReservationStatus.ACTIVE.name().equals(reservation.getStatus())
                ? AttendanceStatus.PENDING.name()
                : null;
        reservationVO.setAttendanceStatus(attendanceStatus);
        reservationVO.setCheckInTime(attendanceRecord != null ? attendanceRecord.getCheckInTime() : null);
        reservationVO.setCanCheckIn(canCheckIn(reservation, attendanceStatus));
        return reservationVO;
    }

    private void validateTime(User currentUser, OffsetDateTime startTime, OffsetDateTime endTime) {
        validateBasicTime(startTime, endTime);
        validateDurationTime(currentUser, startTime, endTime);
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
        if (isTeacher(currentUser)) {
            return;
        }
        long minutes = Duration.between(startTime, endTime).toMinutes();
        int maxSingleReservationMinutes = systemConfigService.getMaxSingleReservationMinutes(getQuotaCreditScore(currentUser));
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

    public void tryConsumeDailyUsageQuota(User currentUser, OffsetDateTime startTime, OffsetDateTime endTime) {
        LocalDate date = toBeijingDate(startTime);
        long addMinutes = Duration.between(startTime, endTime).toMinutes();
        int dailyReservationLimitMinutes = getDailyReservationLimitMinutes(currentUser);

        reservationMapper.initUsage(currentUser.getId(), date);
        int updatedRows = reservationMapper.tryAddUsage(currentUser.getId(), date, addMinutes, dailyReservationLimitMinutes);
        if (updatedRows == 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "已超过当前信用等级对应的当日预约时长上限");
        }
    }

    public Long checkSeatReservableAndGetClassroomId(Long currentUserId, SeatReservationCreateDTO request,
                                                     LocalDateTime utcStartTime, LocalDateTime utcEndTime) {
        Seat seat = seatMapper.selectByIdForUpdate(request.getSeatId());
        if (seat == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "座位不存在");
        }
        if (SeatStatus.DISABLED.name().equals(seat.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "座位不可用");
        }

        Long classroomId = seat.getClassroomId();
        Classroom classroom = classroomMapper.selectByIdForUpdate(classroomId);
        if (classroom == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
        }
        if (!ClassroomStatus.ENABLED.name().equals(classroom.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
        }

        List<Reservation> seatConflicts = reservationMapper.selectSeatConflictsForUpdate(
                request.getSeatId(),
                utcStartTime,
                utcEndTime
        );
        if (!seatConflicts.isEmpty()) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段内座位已被预约");
        }

        boolean withClassroomConflict = !reservationMapper.selectClassroomConflictsForUpdate(
                classroomId,
                utcStartTime,
                utcEndTime
        ).isEmpty();
        if (withClassroomConflict) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段内教室已被整间预约");
        }

        if (!maintenanceWindowMapper.selectSeatConflictsForUpdate(request.getSeatId(), utcStartTime, utcEndTime).isEmpty()
                || !maintenanceWindowMapper.selectClassroomConflictsForUpdate(classroomId, utcStartTime, utcEndTime).isEmpty()) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段资源正在维护，无法预约");
        }

        int conflictRows = reservationMapper.selectStudentTimeConflictForUpdate(
                currentUserId,
                utcStartTime,
                utcEndTime
        );
        if (conflictRows >= 1) {
            throw new BusinessException(ResultCode.CONFLICT, "同一时间段内只允许存在一条预约");
        }

        return classroomId;
    }

    private void checkClassroomReservable(ClassroomReservationCreateDTO request,
                                          LocalDateTime utcStartTime, LocalDateTime utcEndTime) {
        Classroom classroom = classroomMapper.selectByIdForUpdate(request.getClassroomId());
        if (classroom == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
        }
        if (ClassroomStatus.DISABLED.name().equals(classroom.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
        }

        boolean withClassroomConflict = !reservationMapper.selectClassroomConflictsForUpdate(
                request.getClassroomId(),
                utcStartTime,
                utcEndTime
        ).isEmpty();
        if (withClassroomConflict) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段内教室已被整间预约");
        }

        boolean withSeatConflict = !reservationMapper.selectSeatConflictsInClassroomForUpdate(
                request.getClassroomId(),
                utcStartTime,
                utcEndTime
        ).isEmpty();
        if (withSeatConflict) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段内教室中已有座位被预约");
        }

        if (!maintenanceWindowMapper.selectConflictsInClassroomForUpdate(
                request.getClassroomId(),
                utcStartTime,
                utcEndTime
        ).isEmpty()) {
            throw new BusinessException(ResultCode.CONFLICT, "该时间段资源正在维护，无法预约");
        }
    }

    private void applyCancelCreditPenalty(Reservation reservation) {
        int cancelDeductionScore = systemConfigService.getCancelDeductionScore();
        if (cancelDeductionScore <= 0) {
            return;
        }

        User user = userMapper.selectById(reservation.getUserId());
        if (user == null || !"STUDENT".equals(user.getRole())) {
            return;
        }

        int updatedRows = userMapper.decreaseCreditScore(
                user.getId(),
                cancelDeductionScore,
                systemConfigService.getCreditMinScore(),
                systemConfigService.getCreditMaxScore()
        );
        if (updatedRows != 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "更新用户信用信息失败");
        }

        ViolationRecord violationRecord = new ViolationRecord();
        violationRecord.setUserId(user.getId());
        violationRecord.setReservationId(reservation.getId());
        violationRecord.setType(ViolationType.USER_CANCEL.name());
        violationRecord.setRemark("用户主动取消预约，扣除" + cancelDeductionScore + "分信用分。");
        violationRecordMapper.insert(violationRecord);
    }

    private void publishSeatReleaseEventIfNeeded(Reservation reservation) {
        if (!ResourceType.SEAT.name().equals(reservation.getResourceType())) {
            return;
        }
        applicationEventPublisher.publishEvent(new SeatReservationReleasedEvent(
                reservation.getResourceId(),
                reservation.getStartTime(),
                reservation.getEndTime()
        ));
    }

    private User getUserOrThrow(Long currentUserId) {
        User currentUser = userMapper.selectById(currentUserId);
        if (currentUser == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        return currentUser;
    }

    private LocalDateTime toUtcLocalDateTime(OffsetDateTime dateTime) {
        return dateTime == null ? null : dateTime.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    private LocalDate toBeijingDate(OffsetDateTime dateTime) {
        return dateTime.withOffsetSameInstant(BEIJING_OFFSET).toLocalDate();
    }

    private LocalDateTime utcNow() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    private boolean canCheckIn(Reservation reservation, String attendanceStatus) {
        if (!ReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            return false;
        }
        if (!AttendanceStatus.PENDING.name().equals(attendanceStatus)) {
            return false;
        }
        LocalDateTime now = utcNow();
        long checkInEarlyMinutes = systemConfigService.getCheckInEarlyMinutes();
        long checkInGraceMinutes = systemConfigService.getCheckInGraceMinutes();
        LocalDateTime earliest = reservation.getStartTime().minusMinutes(checkInEarlyMinutes);
        LocalDateTime latest = reservation.getStartTime().plusMinutes(checkInGraceMinutes);
        return !now.isBefore(earliest) && !now.isAfter(latest);
    }

    private Integer getQuotaCreditScore(User user) {
        if (isTeacher(user)) {
            return systemConfigService.getCreditMaxScore();
        }
        return user == null ? null : user.getCreditScore();
    }

    private int getDailyReservationLimitMinutes(User user) {
        if (isTeacher(user)) {
            return Integer.MAX_VALUE;
        }
        return systemConfigService.getDailyReservationLimitMinutes(getQuotaCreditScore(user));
    }

    private boolean isTeacher(User user) {
        return user != null && "TEACHER".equals(user.getRole());
    }

    private String formatMinutesText(int minutes) {
        if (minutes % 60 == 0) {
            return (minutes / 60) + "小时";
        }
        return minutes + "分钟";
    }
}
