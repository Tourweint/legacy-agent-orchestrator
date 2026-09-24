package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.entity.AttendanceRecord;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.entity.User;
import org.campus.classroom.entity.ViolationRecord;
import org.campus.classroom.enums.AttendanceStatus;
import org.campus.classroom.enums.ReservationStatus;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.ViolationType;
import org.campus.classroom.event.SeatReservationReleasedEvent;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.AttendanceMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.UserMapper;
import org.campus.classroom.mapper.ViolationRecordMapper;
import org.campus.classroom.service.NotificationService;
import org.campus.classroom.service.SystemConfigService;
import org.campus.classroom.service.impl.AttendanceServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AttendanceServiceImplTest {

    @Mock
    private ReservationMapper reservationMapper;
    @Mock
    private AttendanceMapper attendanceMapper;
    @Mock
    private ViolationRecordMapper violationRecordMapper;
    @Mock
    private UserMapper userMapper;
    @Mock
    private NotificationService notificationService;
    @Mock
    private SystemConfigService systemConfigService;
    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    @InjectMocks
    private AttendanceServiceImpl attendanceService;

    // 验证学生在允许的签到时间窗口内可以成功完成签到。
    @Test
    void checkIn_shouldSucceedForStudentWithinWindow() {
        Long userId = 10001L;
        Long reservationId = 20001L;
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        User student = new User();
        student.setId(userId);
        student.setRole("STUDENT");
        student.setCreditScore(88);

        Reservation reservation = new Reservation();
        reservation.setId(reservationId);
        reservation.setUserId(userId);
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        reservation.setStartTime(now.plusMinutes(5));
        reservation.setEndTime(now.plusHours(2));

        AttendanceRecord attendanceRecord = new AttendanceRecord();
        attendanceRecord.setReservationId(reservationId);
        attendanceRecord.setStatus(AttendanceStatus.PENDING.name());

        when(userMapper.selectById(userId)).thenReturn(student);
        when(reservationMapper.selectByReservationIdAndUserIdForUpdate(reservationId, userId)).thenReturn(reservation);
        when(systemConfigService.getCheckInEarlyMinutes()).thenReturn(10);
        when(systemConfigService.getCheckInGraceMinutes()).thenReturn(15);
        when(attendanceMapper.selectByReservationIdForUpdate(reservationId)).thenReturn(attendanceRecord);
        when(attendanceMapper.updateToCheckedIn(eq(reservationId), any(LocalDateTime.class))).thenReturn(1);
        when(systemConfigService.getCheckInRewardScore()).thenReturn(0);
        when(systemConfigService.getSuccessStreakSize()).thenReturn(0);

        assertEquals(true, attendanceService.checkIn(userId, reservationId));
        verify(attendanceMapper).insertStatusIfAbsent(reservationId, AttendanceStatus.PENDING.name());
        verify(attendanceMapper).updateToCheckedIn(eq(reservationId), any(LocalDateTime.class));
        verify(userMapper, never()).increaseCreditScore(anyLong(), anyInt(), anyInt(), anyInt());
    }

    // 验证非学生角色不能执行座位预约签到。
    @Test
    void checkIn_shouldRejectNonStudentUser() {
        Long userId = 10002L;

        User teacher = new User();
        teacher.setId(userId);
        teacher.setRole("TEACHER");

        when(userMapper.selectById(userId)).thenReturn(teacher);

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> attendanceService.checkIn(userId, 1L)
        );

        assertEquals(ResultCode.BAD_REQUEST, exception.getResultCode());
        verify(reservationMapper, never()).selectByReservationIdAndUserIdForUpdate(anyLong(), anyLong());
    }

    // 验证签到成功后会按规则叠加基础奖励和连续签到奖励。
    @Test
    void checkIn_shouldApplyCheckInRewardAndStreakReward() {
        Long userId = 10003L;
        Long reservationId = 20003L;
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        User student = new User();
        student.setId(userId);
        student.setRole("STUDENT");
        student.setCreditScore(90);

        Reservation currentReservation = reservation(userId, reservationId, now.plusMinutes(5), now.plusHours(1), ResourceType.SEAT.name());
        currentReservation.setStatus(ReservationStatus.ACTIVE.name());

        AttendanceRecord currentAttendance = new AttendanceRecord();
        currentAttendance.setReservationId(reservationId);
        currentAttendance.setStatus(AttendanceStatus.PENDING.name());

        Reservation previousReservation1 = reservation(userId, 10L, now.minusDays(1), now.minusDays(1).plusHours(1), ResourceType.SEAT.name());
        Reservation previousReservation2 = reservation(userId, 11L, now.minusDays(2), now.minusDays(2).plusHours(1), ResourceType.SEAT.name());

        when(userMapper.selectById(userId)).thenReturn(student);
        when(reservationMapper.selectByReservationIdAndUserIdForUpdate(reservationId, userId)).thenReturn(currentReservation);
        when(systemConfigService.getCheckInEarlyMinutes()).thenReturn(10);
        when(systemConfigService.getCheckInGraceMinutes()).thenReturn(15);
        when(attendanceMapper.selectByReservationIdForUpdate(reservationId)).thenReturn(currentAttendance);
        when(attendanceMapper.updateToCheckedIn(eq(reservationId), any(LocalDateTime.class))).thenReturn(1);
        when(systemConfigService.getCheckInRewardScore()).thenReturn(1);
        when(systemConfigService.getSuccessStreakSize()).thenReturn(3);
        when(systemConfigService.getSuccessStreakRewardScore()).thenReturn(2);
        when(systemConfigService.getCreditMinScore()).thenReturn(30);
        when(systemConfigService.getCreditMaxScore()).thenReturn(100);
        when(reservationMapper.selectByUserId(userId)).thenReturn(List.of(currentReservation, previousReservation1, previousReservation2));
        when(attendanceMapper.selectByReservationIds(List.of(reservationId, 10L, 11L))).thenReturn(List.of(
                checkedInAttendance(reservationId),
                checkedInAttendance(10L),
                checkedInAttendance(11L)
        ));
        when(userMapper.increaseCreditScore(userId, 1, 30, 100)).thenReturn(1);
        when(userMapper.increaseCreditScore(userId, 2, 30, 100)).thenReturn(1);

        attendanceService.checkIn(userId, reservationId);

        verify(userMapper).increaseCreditScore(userId, 1, 30, 100);
        verify(userMapper).increaseCreditScore(userId, 2, 30, 100);
    }

    // 验证爽约扫描会自动取消预约、扣减信用分、记录违规并发布座位释放事件。
    @Test
    void markNoShows_shouldCancelReservationDeductCreditAndPublishEvent() {
        Long userId = 10004L;
        Long reservationId = 30001L;
        Long seatId = 501L;
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        Reservation reservation = reservation(
                userId,
                reservationId,
                now.minusMinutes(20),
                now.plusMinutes(40),
                ResourceType.SEAT.name()
        );
        reservation.setResourceId(seatId);
        reservation.setStatus(ReservationStatus.ACTIVE.name());
        reservation.setReserveDate(LocalDate.now(ZoneOffset.ofHours(8)));

        AttendanceRecord attendanceRecord = new AttendanceRecord();
        attendanceRecord.setReservationId(reservationId);
        attendanceRecord.setStatus(AttendanceStatus.PENDING.name());

        User student = new User();
        student.setId(userId);
        student.setRole("STUDENT");

        when(systemConfigService.getCheckInGraceMinutes()).thenReturn(15);
        when(reservationMapper.selectReservationsDueForNoShow(any(LocalDateTime.class))).thenReturn(List.of(reservation));
        when(reservationMapper.selectByIdForUpdate(reservationId)).thenReturn(reservation);
        when(attendanceMapper.selectByReservationIdForUpdate(reservationId)).thenReturn(attendanceRecord);
        when(attendanceMapper.updateStatusIfPending(reservationId, AttendanceStatus.NO_SHOW.name())).thenReturn(1);
        when(reservationMapper.noShowCancelReservation(reservationId)).thenReturn(1);
        when(reservationMapper.minusUsage(userId, reservation.getReserveDate(), 60L)).thenReturn(1);
        when(userMapper.selectById(userId)).thenReturn(student);
        when(systemConfigService.getNoShowDeductionScore()).thenReturn(2);
        when(systemConfigService.getCreditMinScore()).thenReturn(30);
        when(systemConfigService.getCreditMaxScore()).thenReturn(100);
        when(userMapper.decreaseCreditScore(userId, 2, 30, 100)).thenReturn(1);

        assertEquals(1, attendanceService.markNoShows());

        ArgumentCaptor<ViolationRecord> violationCaptor = ArgumentCaptor.forClass(ViolationRecord.class);
        verify(violationRecordMapper).insert(violationCaptor.capture());
        assertEquals(ViolationType.NO_SHOW.name(), violationCaptor.getValue().getType());
        assertEquals(userId, violationCaptor.getValue().getUserId());

        ArgumentCaptor<SeatReservationReleasedEvent> eventCaptor = ArgumentCaptor.forClass(SeatReservationReleasedEvent.class);
        verify(applicationEventPublisher).publishEvent(eventCaptor.capture());
        assertEquals(seatId, eventCaptor.getValue().seatId());
        assertEquals(reservation.getStartTime(), eventCaptor.getValue().startTime());
        assertEquals(reservation.getEndTime(), eventCaptor.getValue().endTime());

        verify(notificationService).createSystemNotification(eq(userId), eq("RESERVATION_NO_SHOW"), any(), any());
    }

    private Reservation reservation(Long userId, Long reservationId, LocalDateTime start, LocalDateTime end, String resourceType) {
        Reservation reservation = new Reservation();
        reservation.setId(reservationId);
        reservation.setUserId(userId);
        reservation.setResourceType(resourceType);
        reservation.setResourceId(1L);
        reservation.setClassroomId(2L);
        reservation.setStartTime(start);
        reservation.setEndTime(end);
        reservation.setReserveDate(start.atOffset(ZoneOffset.UTC).withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate());
        return reservation;
    }

    private AttendanceRecord checkedInAttendance(Long reservationId) {
        AttendanceRecord record = new AttendanceRecord();
        record.setReservationId(reservationId);
        record.setStatus(AttendanceStatus.CHECKED_IN.name());
        return record;
    }
}
