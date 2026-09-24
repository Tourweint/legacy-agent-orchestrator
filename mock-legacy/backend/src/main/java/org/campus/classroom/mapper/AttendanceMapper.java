package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.*;
import org.campus.classroom.entity.AttendanceRecord;

import java.time.LocalDateTime;
import java.util.List;

public interface AttendanceMapper {

    @Insert("""
            INSERT INTO reservation_attendance (reservation_id, status)
            VALUES (#{reservationId}, #{status})
            ON DUPLICATE KEY UPDATE reservation_id = reservation_id
            """)
    int insertStatusIfAbsent(@Param("reservationId") Long reservationId, @Param("status") String status);

    @Select("""
            <script>
            SELECT id, reservation_id, status, check_in_time, create_time, update_time
            FROM reservation_attendance
            WHERE reservation_id IN
            <foreach collection="reservationIds" item="reservationId" open="(" separator="," close=")">
                #{reservationId}
            </foreach>
            </script>
            """)
    @Results(id = "attendanceResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "reservation_id", property = "reservationId"),
            @Result(column = "status", property = "status"),
            @Result(column = "check_in_time", property = "checkInTime"),
            @Result(column = "create_time", property = "createTime"),
            @Result(column = "update_time", property = "updateTime")
    })
    List<AttendanceRecord> selectByReservationIds(@Param("reservationIds") List<Long> reservationIds);

    @Select("""
            SELECT id, reservation_id, status, check_in_time, create_time, update_time
            FROM reservation_attendance
            WHERE reservation_id = #{reservationId}
            FOR UPDATE
            """)
    @ResultMap("attendanceResultMap")
    AttendanceRecord selectByReservationIdForUpdate(@Param("reservationId") Long reservationId);

    @Update("""
            UPDATE reservation_attendance
            SET status = 'CHECKED_IN',
                check_in_time = #{checkInTime}
            WHERE reservation_id = #{reservationId}
              AND status = 'PENDING'
            """)
    int updateToCheckedIn(@Param("reservationId") Long reservationId, @Param("checkInTime") LocalDateTime checkInTime);

    @Update("""
            UPDATE reservation_attendance
            SET status = #{status}
            WHERE reservation_id = #{reservationId}
              AND status = 'PENDING'
            """)
    int updateStatusIfPending(@Param("reservationId") Long reservationId, @Param("status") String status);
}
