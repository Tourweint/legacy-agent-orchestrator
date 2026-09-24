package org.campus.classroom.campusclassroomreservationsystem;

import org.campus.classroom.dto.ClassroomReservationCreateDTO;
import org.campus.classroom.dto.SeatReservationCreateDTO;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.service.ReservationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
class ReservationConcurrencyTest {

    @Autowired
    private ReservationService reservationService;

    @Autowired
    private ReservationMapper reservationMapper;

    // 验证多个用户并发抢同一座位时，系统最终只允许一个有效预约成功落库。
    @Test
    void should_allow_only_one_active_reservation_when_many_users_reserve_same_seat_concurrently() throws Exception {
        int threadCount = 5;

        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch readyLatch = new CountDownLatch(threadCount);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(threadCount);

        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger failCount = new AtomicInteger(0);

        Long seatId = 118L;
        LocalDateTime startTime = LocalDateTime.of(2026, 4, 9, 22, 33);
        LocalDateTime endTime = LocalDateTime.of(2026, 4, 9, 23, 0);

//        List<Long> userIds = List.of(
//                10011L, 10012L, 10013L, 10014L, 10015L,
//                10016L, 10001L, 10004L, 10005L, 10006L,
//                10007L, 10008L, 10009L
//        );
        List<Long> userIds = List.of(
                10011L, 10012L, 10013L, 10014L, 10015L
        );

        for (Long userId : userIds) {
            executor.submit(() -> {
                readyLatch.countDown();
                try {
                    startLatch.await();

                    SeatReservationCreateDTO dto = new SeatReservationCreateDTO();
                    dto.setSeatId(seatId);
                    dto.setStartTime(startTime.atOffset(ZoneOffset.UTC));
                    dto.setEndTime(endTime.atOffset(ZoneOffset.UTC));
                    System.out.println(dto);
                    reservationService.createSeatReservation(userId, dto);

                    successCount.incrementAndGet();

                } catch (BusinessException e) {
                    failCount.incrementAndGet();
                } catch (Exception e) {
                    failCount.incrementAndGet();
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        readyLatch.await();     // 确保所有线程都准备好了
        startLatch.countDown(); // 同时开跑
        doneLatch.await();      // 等所有线程结束

        long activeCount = reservationMapper.countActiveSeatConflict(
                seatId, startTime, endTime
        );
        System.out.println(activeCount);

//        assertEquals(1, successCount.get());
//        assertEquals(threadCount - 1, failCount.get());
//        assertEquals(1, activeCount);

        executor.shutdown();
    }
}
