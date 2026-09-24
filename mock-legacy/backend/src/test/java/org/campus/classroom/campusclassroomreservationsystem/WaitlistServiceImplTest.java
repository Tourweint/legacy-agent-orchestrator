package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.dto.WaitlistCreateDTO;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.entity.User;
import org.campus.classroom.entity.WaitlistEntry;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
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
import org.campus.classroom.service.impl.WaitlistServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WaitlistServiceImplTest {

    @Mock
    private WaitlistEntryMapper waitlistEntryMapper;
    @Mock
    private SeatMapper seatMapper;
    @Mock
    private ClassroomMapper classroomMapper;
    @Mock
    private ReservationMapper reservationMapper;
    @Mock
    private MaintenanceWindowMapper maintenanceWindowMapper;
    @Mock
    private UserMapper userMapper;
    @Mock
    private ReservationService reservationService;
    @Mock
    private NotificationService notificationService;
    @Mock
    private SystemConfigService systemConfigService;

    @InjectMocks
    private WaitlistServiceImpl waitlistService;

    // 验证当座位当前时段已被占用时，学生可以成功加入候补队列。
    @Test
    void createSeatWaitlist_shouldCreateSuccessfullyWhenSeatIsOccupied() {
        Long userId = 10001L;
        Long seatId = 88L;
        OffsetDateTime start = validFutureStartTime();
        OffsetDateTime end = start.plusHours(2);

        WaitlistCreateDTO request = new WaitlistCreateDTO();
        request.setSeatId(seatId);
        request.setStartTime(start);
        request.setEndTime(end);
        request.setReason("self-study");

        User student = new User();
        student.setId(userId);
        student.setRole("STUDENT");
        student.setCreditScore(90);

        Seat seat = new Seat();
        seat.setId(seatId);
        seat.setClassroomId(9L);
        seat.setStatus(SeatStatus.ENABLED.name());

        Classroom classroom = new Classroom();
        classroom.setId(9L);
        classroom.setBuilding("Building A");
        classroom.setRoomNumber("101");
        classroom.setStatus(ClassroomStatus.ENABLED.name());

        when(userMapper.selectById(userId)).thenReturn(student);
        when(systemConfigService.getMaxSingleReservationMinutes(90)).thenReturn(180);
        when(systemConfigService.getSeatReservationAdvanceHours(90)).thenReturn(24);
        when(systemConfigService.getDailyReservationLimitMinutes(90)).thenReturn(600);
        when(seatMapper.selectById(seatId)).thenReturn(seat);
        when(classroomMapper.selectById(9L)).thenReturn(classroom);
        when(maintenanceWindowMapper.selectSeatConflictsForUpdate(eq(seatId), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(Collections.emptyList());
        when(maintenanceWindowMapper.selectClassroomConflictsForUpdate(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.selectStudentTimeConflictForUpdate(eq(userId), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0);
        when(reservationMapper.selectUsedMinutes(userId, start.withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate())).thenReturn(60L);
        when(waitlistEntryMapper.countWaitingDuplicate(eq(userId), eq(seatId), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0);
        when(reservationMapper.countActiveSeatConflict(eq(seatId), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(1L);
        when(reservationMapper.countClassroomConflicts(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0);
        doAnswer(invocation -> {
            WaitlistEntry entry = invocation.getArgument(0);
            entry.setId(7001L);
            return 1;
        }).when(waitlistEntryMapper).insert(any(WaitlistEntry.class));

        Long waitlistId = waitlistService.createSeatWaitlist(userId, request);

        assertEquals(7001L, waitlistId);
        ArgumentCaptor<WaitlistEntry> captor = ArgumentCaptor.forClass(WaitlistEntry.class);
        verify(waitlistEntryMapper).insert(captor.capture());
        assertEquals(userId, captor.getValue().getUserId());
        assertEquals(seatId, captor.getValue().getSeatId());
        assertEquals("WAITING", captor.getValue().getStatus());
    }

    // 验证当资源已经可以直接预约时，系统会拒绝无意义的候补申请。
    @Test
    void createSeatWaitlist_shouldRejectWhenResourceIsAlreadyAvailable() {
        Long userId = 10002L;
        Long seatId = 89L;
        OffsetDateTime start = validFutureStartTime();
        OffsetDateTime end = start.plusHours(1);

        WaitlistCreateDTO request = new WaitlistCreateDTO();
        request.setSeatId(seatId);
        request.setStartTime(start);
        request.setEndTime(end);

        User student = new User();
        student.setId(userId);
        student.setRole("STUDENT");
        student.setCreditScore(90);

        Seat seat = new Seat();
        seat.setId(seatId);
        seat.setClassroomId(10L);
        seat.setStatus(SeatStatus.ENABLED.name());

        Classroom classroom = new Classroom();
        classroom.setId(10L);
        classroom.setStatus(ClassroomStatus.ENABLED.name());

        when(userMapper.selectById(userId)).thenReturn(student);
        when(systemConfigService.getMaxSingleReservationMinutes(90)).thenReturn(180);
        when(systemConfigService.getSeatReservationAdvanceHours(90)).thenReturn(24);
        when(systemConfigService.getDailyReservationLimitMinutes(90)).thenReturn(600);
        when(seatMapper.selectById(seatId)).thenReturn(seat);
        when(classroomMapper.selectById(10L)).thenReturn(classroom);
        when(maintenanceWindowMapper.selectSeatConflictsForUpdate(eq(seatId), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(Collections.emptyList());
        when(maintenanceWindowMapper.selectClassroomConflictsForUpdate(eq(10L), any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(Collections.emptyList());
        when(reservationMapper.selectStudentTimeConflictForUpdate(eq(userId), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0);
        when(reservationMapper.selectUsedMinutes(userId, start.withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate())).thenReturn(0L);
        when(waitlistEntryMapper.countWaitingDuplicate(eq(userId), eq(seatId), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0);
        when(reservationMapper.countActiveSeatConflict(eq(seatId), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0L);
        when(reservationMapper.countClassroomConflicts(eq(10L), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(0);

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> waitlistService.createSeatWaitlist(userId, request)
        );

        assertEquals(ResultCode.BAD_REQUEST, exception.getResultCode());
        verify(waitlistEntryMapper, never()).insert(any(WaitlistEntry.class));
    }

    // 验证座位释放后候补补位会自动创建预约并发送成功通知。
    @Test
    void processReleasedSeatWaitlists_shouldPromoteCandidateAndNotify() {
        Long seatId = 90L;
        Long waitlistId = 8001L;
        Long userId = 10003L;
        Long classroomId = 11L;
        LocalDateTime start = LocalDateTime.now(ZoneOffset.UTC).plusHours(1);
        LocalDateTime end = start.plusHours(2);

        WaitlistEntry candidate = new WaitlistEntry();
        candidate.setId(waitlistId);
        candidate.setUserId(userId);
        candidate.setSeatId(seatId);
        candidate.setClassroomId(classroomId);
        candidate.setStartTime(start);
        candidate.setEndTime(end);
        candidate.setReason("candidate");

        Classroom classroom = new Classroom();
        classroom.setId(classroomId);
        classroom.setBuilding("Building B");
        classroom.setRoomNumber("202");

        Seat seat = new Seat();
        seat.setId(seatId);
        seat.setSeatNumber("2-3");

        when(waitlistEntryMapper.selectWaitingCandidatesForSeat(seatId, start, end)).thenReturn(List.of(candidate));
        when(reservationService.createSeatReservation(eq(userId), any())).thenReturn(9001L);
        when(waitlistEntryMapper.markPromoted(waitlistId, 9001L)).thenReturn(1);
        when(classroomMapper.selectById(classroomId)).thenReturn(classroom);
        when(seatMapper.selectById(seatId)).thenReturn(seat);

        waitlistService.processReleasedSeatWaitlists(seatId, start, end);

        verify(waitlistEntryMapper).markPromoted(waitlistId, 9001L);
        verify(notificationService).createSystemNotification(eq(userId), eq("WAITLIST_PROMOTED"), any(), any());
    }

    // 验证只有处于等待状态的候补申请才允许被取消。
    @Test
    void cancelWaitlist_shouldRejectWhenEntryIsNotWaiting() {
        WaitlistEntry entry = new WaitlistEntry();
        entry.setId(9002L);
        entry.setUserId(10004L);
        entry.setStatus("PROMOTED");

        when(waitlistEntryMapper.selectByIdAndUserId(9002L, 10004L)).thenReturn(entry);

        BusinessException exception = assertThrows(
                BusinessException.class,
                () -> waitlistService.cancelWaitlist(10004L, 9002L)
        );

        assertEquals(ResultCode.BAD_REQUEST, exception.getResultCode());
    }

    private OffsetDateTime validFutureStartTime() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.ofHours(8));
        if (now.getHour() <= 20) {
            return now.plusHours(1).withMinute(0).withSecond(0).withNano(0);
        }
        return now.plusDays(1).withHour(8).withMinute(0).withSecond(0).withNano(0);
    }
}
