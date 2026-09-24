package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.*;
import org.campus.classroom.entity.Reservation;
import org.campus.classroom.vo.BuildingPreferenceVO;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public interface ReservationMapper {

    @Insert("""
            INSERT INTO reservation (
                user_id,resource_type,resource_id,classroom_id,reserve_date,start_time,end_time,reason,status)
            VALUES (
                #{userId},#{resourceType},#{resourceId},#{classroomId},#{reserveDate},#{startTime},#{endTime},#{reason},#{status})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Reservation reservation);

    @Select("SELECT * FROM reservation WHERE id=#{id}")
    @Results(id = "reservationResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "user_id", property = "userId"),
            @Result(column = "resource_type", property = "resourceType"),
            @Result(column = "resource_id", property = "resourceId"),
            @Result(column = "classroom_id", property = "classroomId"),
            @Result(column = "reserve_date", property = "reserveDate"),
            @Result(column = "start_time", property = "startTime"),
            @Result(column = "end_time", property = "endTime"),
            @Result(column = "reason", property = "reason"),
            @Result(column = "status", property = "status"),
            @Result(column = "create_time", property = "createTime"),
            @Result(column = "update_time", property = "updateTime")
    })
    Reservation selectById(Long id);

    @Select("""
            SELECT *
            FROM reservation
            WHERE id = #{id}
            FOR UPDATE
            """)
    @ResultMap("reservationResultMap")
    Reservation selectByIdForUpdate(@Param("id") Long id);

    @Select("SELECT * FROM reservation WHERE user_id=#{userId} ORDER BY create_time DESC")
    @ResultMap("reservationResultMap")
    List<Reservation> selectByUserId(Long userId);

    @Select("""
            SELECT *
            FROM reservation
            WHERE id = #{id}
              AND user_id = #{userId}
            """)
    @ResultMap("reservationResultMap")
    Reservation selectByReservationIdAndUserId(@Param("id") Long id, @Param("userId") Long userId);

    @Select("""
            SELECT *
            FROM reservation
            WHERE id = #{id}
              AND user_id = #{userId}
            FOR UPDATE
            """)
    @ResultMap("reservationResultMap")
    Reservation selectByReservationIdAndUserIdForUpdate(@Param("id") Long id, @Param("userId") Long userId);

    @Insert("""
            INSERT INTO reservation_usage (user_id, date, used_minutes)
            VALUES (#{userId}, #{date}, 0)
            ON DUPLICATE KEY UPDATE used_minutes = used_minutes
            """)
    //ON DUPLICATE KEY UPDATE used_minutes = used_minutes 处理重复插入的异常
    int initUsage(@Param("userId") Long userId, @Param("date") LocalDate date);

    @Update("""
            UPDATE reservation_usage
            SET used_minutes = used_minutes + #{addMinutes}
            WHERE user_id = #{userId}
              AND date = #{date}
              AND used_minutes + #{addMinutes} <= #{maxMinutes}
            """)
    int tryAddUsage(@Param("userId") Long userId,
                    @Param("date") LocalDate date,
                    @Param("addMinutes") Long addMinutes,
                    @Param("maxMinutes") Integer maxMinutes);

    @Update("""
            UPDATE reservation_usage
            SET used_minutes = used_minutes - #{minusMinutes}
            WHERE user_id = #{userId}
              AND date = #{date}
              AND used_minutes - #{minusMinutes} >= 0
            """)
    int minusUsage(@Param("userId") Long userId, @Param("date") LocalDate date,@Param("minusMinutes") Long minusMinutes);

    @Select("""
            SELECT COALESCE((
                SELECT used_minutes
                FROM reservation_usage
                WHERE user_id = #{userId}
                  AND date = #{date}
                LIMIT 1
            ), 0)
            """)
    long selectUsedMinutes(@Param("userId") Long userId, @Param("date") LocalDate date);


    @Select("""
            SELECT *
            FROM reservation
            WHERE user_id = #{userId}
              AND status = 'ACTIVE'
              AND start_time >= #{startTime}
              AND start_time < #{endTime}
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectByUserIdAndTimeRange(@Param("userId") Long userId, @Param("startTime") LocalDateTime startTime, @Param("endTime") LocalDateTime endTime);

    @Select("SELECT * FROM reservation ORDER BY create_time DESC")
    @ResultMap("reservationResultMap")
    List<Reservation> selectAll();

    @Select("""
            SELECT c.building AS building, count(*) AS reservation_count
            FROM reservation r
            JOIN classroom c ON r.classroom_id = c.id
            WHERE r.user_id = #{userId}
            GROUP BY c.building
            ORDER BY reservation_count DESC, c.building ASC
            """)
    @Results(id = "buildingPreferenceResultMap", value = {
            @Result(column = "building", property = "building"),
            @Result(column = "reservation_count", property = "reservationCount")
    })
    List<BuildingPreferenceVO> selectPreferredBuildingsByUserId(@Param("userId") Long userId);

    @Select("""
            <script>
            SELECT *
            FROM reservation
            <where>
                <if test="status != null and status != ''">
                    AND status = #{status}
                </if>
                <if test="keyword != null and keyword != ''">
                    AND (
                        CAST(user_id AS CHAR) LIKE CONCAT('%', #{keyword}, '%')
                        OR CAST(resource_id AS CHAR) LIKE CONCAT('%', #{keyword}, '%')
                        OR reason LIKE CONCAT('%', #{keyword}, '%')
                    )
                </if>
            </where>
            ORDER BY create_time DESC, id DESC
            </script>
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectAdminList(@Param("keyword") String keyword,
                                      @Param("status") String status);

    @Update("""
            UPDATE reservation
            SET status = 'CANCELLED'
            WHERE id = #{id}
              AND status = 'ACTIVE'
              AND end_time >= UTC_TIMESTAMP()
            """)
    int cancelReservation(@Param("id") Long id);

    @Update("""
            UPDATE reservation
            SET status = 'CANCELLED'
            WHERE id = #{id}
              AND status = 'ACTIVE'
            """)
    int adminCancelReservation(@Param("id") Long id);

    @Update("""
            UPDATE reservation
            SET status = 'CANCELLED'
            WHERE id = #{id}
              AND status = 'ACTIVE'
            """)
    int noShowCancelReservation(@Param("id") Long id);

    @Update("""
            UPDATE reservation
            SET status = 'EXPIRED'
            WHERE status = 'ACTIVE'
              AND end_time < UTC_TIMESTAMP()
            """)
    int expireActiveReservations();

    @Select("""
            SELECT r.*
            FROM reservation r
            LEFT JOIN reservation_attendance a ON a.reservation_id = r.id
            WHERE r.status = 'ACTIVE'
              AND r.resource_type = 'SEAT'
              AND r.start_time <= #{latestAllowedCheckIn}
              AND (a.id IS NULL OR a.status = 'PENDING')
            ORDER BY r.start_time ASC, r.id ASC
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectReservationsDueForNoShow(@Param("latestAllowedCheckIn") LocalDateTime latestAllowedCheckIn);


    @Select("""
            SELECT *
            FROM reservation
            WHERE user_id = #{userId}
              AND status = #{status}
            ORDER BY create_time DESC
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectByUserIdAndStatus(@Param("userId") Long userId,
                                              @Param("status") String status);

    @Select("""
            SELECT *
            FROM reservation
            WHERE user_id = #{userId}
              AND status != #{status}
            ORDER BY create_time DESC
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectByUserIdAndNotStatus(@Param("userId") Long userId,
                                                 @Param("status") String status);

    @Select("""
            SELECT *
            FROM reservation
            WHERE resource_type='SEAT'
              AND resource_id=#{seatId}
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectSeatConflictsForUpdate(@Param("seatId") Long seatId,
                                                   @Param("startTime") LocalDateTime startTime,//开始时间必须在其他预约中的结束之前之后,否则冲突, end_time > #{startTime} 就冲突
                                                   @Param("endTime") LocalDateTime endTime);//结束时间必须在其他预约中的开始时间之前,否则冲突, start_time < #{endTime} 就冲突

    @Select("""
            SELECT *
            FROM reservation
            WHERE resource_type='CLASSROOM'
              AND resource_id=#{classroomId}
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectClassroomConflictsForUpdate(@Param("classroomId") Long classroomId,
                                                        @Param("startTime") LocalDateTime startTime,
                                                        @Param("endTime") LocalDateTime endTime);

    //查询classroom预约时有无seat被预约
    @Select("""
            SELECT *
            FROM reservation
            WHERE classroom_id = #{classroomId}
              AND resource_type = 'SEAT'
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    @ResultMap("reservationResultMap")
    List<Reservation> selectSeatConflictsInClassroomForUpdate(@Param("classroomId") Long classroomId,
                                                              @Param("startTime") LocalDateTime startTime,
                                                              @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT count(*)
            FROM reservation
            WHERE user_id=#{userId}
              AND resource_type = 'SEAT'
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    int selectStudentTimeConflictForUpdate(@Param("userId") Long userId,
                                           @Param("startTime") LocalDateTime startTime,
                                           @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT count(*)
            FROM reservation
            WHERE resource_type='SEAT'
              AND resource_id=#{seatId}
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            """)
    long countActiveSeatConflict(Long seatId, LocalDateTime startTime, LocalDateTime endTime);

    @Select("""
            SELECT DISTINCT resource_id
            FROM reservation
            WHERE classroom_id = #{classroomId}
              AND resource_type = 'SEAT'
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            """)
    List<Long> selectReservedSeatIdsInClassroom(@Param("classroomId") Long classroomId,
                                                @Param("startTime") LocalDateTime startTime,
                                                @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT count(*)
            FROM reservation
            WHERE resource_type = 'CLASSROOM'
              AND resource_id = #{classroomId}
              AND status = 'ACTIVE'
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            """)
    int countClassroomConflicts(@Param("classroomId") Long classroomId,
                                @Param("startTime") LocalDateTime startTime,
                                @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT count(*)
            FROM reservation
            WHERE resource_type = 'SEAT'
              AND resource_id = #{seatId}
              AND status = 'ACTIVE'
            """)
    int countActiveReservationsBySeatId(Long seatId);
}
