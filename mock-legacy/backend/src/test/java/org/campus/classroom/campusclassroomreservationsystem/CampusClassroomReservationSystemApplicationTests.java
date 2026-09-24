package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.enums.ResourceType;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.service.ClassroomService;
import org.campus.classroom.service.ReservationService;
import org.campus.classroom.service.TokenService;
import org.campus.classroom.vo.ClassroomVO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
class CampusClassroomReservationSystemApplicationTests {
    @Autowired
    private TokenService tokenService;

    @Autowired
    ClassroomService service;
    @Autowired
    ClassroomMapper classroomMapper;
    @Autowired
    SeatMapper seatMapper;

    @Autowired
    ReservationService reservationService;
    @Autowired
    private ReservationMapper reservationMapper;

    private ClassroomVO classroomToClassroomVO(Classroom classroom) {
        ClassroomVO classroomVO = new ClassroomVO();
        BeanUtils.copyProperties(classroom, classroomVO);
        classroomVO.setCapacity(classroom.getSeatRows() * classroom.getSeatCols());
        return classroomVO;
    }

    // 验证 Spring Boot 测试上下文可以正常启动。
    @Test
    void contextLoads() {
    }

    // 验证示例预约时长累计后会超过每日预约上限。
    @Test
    void shouldExceedDailyLimit() {
        LocalDate date = LocalDate.of(2026, 4, 21);

        List<Reservation> todayReservations = List.of(
                new Reservation(
                        122L, 10004L, ResourceType.CLASSROOM.name(), 6L, 6L,
                        LocalDateTime.of(2026, 4, 21, 9, 0),
                        LocalDateTime.of(2026, 4, 21, 12, 0),
                        "ACTIVE"
                ),
                new Reservation(
                        2222L, 10004L, ResourceType.CLASSROOM.name(), 6L, 6L,
                        LocalDateTime.of(2026, 4, 21, 13, 0),
                        LocalDateTime.of(2026, 4, 21, 18, 0),
                        "ACTIVE"
                )
        );

        // 已有 8 小时
        long totalMinutes = todayReservations.stream()
                .mapToLong(r -> Duration.between(r.getStartTime(), r.getEndTime()).toMinutes())
                .sum();

        // 再加 2 小时
        long addMinutes = 2 * 60;

        boolean exceed = (totalMinutes + addMinutes > 9 * 60);

        assertTrue(exceed);
    }

}
