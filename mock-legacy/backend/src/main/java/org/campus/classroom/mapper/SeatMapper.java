package org.campus.classroom.mapper;


import org.apache.ibatis.annotations.*;
import org.campus.classroom.entity.Seat;

import java.util.Collection;
import java.util.List;

@Mapper
public interface SeatMapper {
    @Select("""
            select *
            from seat
            where id = #{id}
            """)
    @Results(id = "seatResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "classroom_id", property = "classroomId"),
            @Result(column = "seat_number", property = "seatNumber"),
            @Result(column = "row_number", property = "rowNumber"),
            @Result(column = "col_number", property = "colNumber"),
            @Result(column = "status", property = "status"),
            @Result(column = "remark", property = "remark")
    })
    Seat selectById(Long id);


    @Select("""
            select *
            from seat
            where id = #{id}
            for update
            """)
    @ResultMap("seatResultMap")
    Seat selectByIdForUpdate(Long id);

    @Select("""
            <script>
            select *
            from seat
            where id in
            <foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach>
            </script>
            """)
    @ResultMap("seatResultMap")
    List<Seat> selectByIds(@Param("ids") Collection<Long> ids);

    @Select("""
            select id,classroom_id, seat_number, `row_number`, col_number, status, remark
            from seat
            where classroom_id = #{classroomId}
            order by `row_number` , col_number
            """)
    @ResultMap("seatResultMap")
    List<Seat> selectByClassroomId(Long classroomId);

    @Select("""
            select count(*)
            from seat
            where classroom_id = #{classroomId}
            """)
    int countByClassroomId(Long classroomId);

    @Select("""
            select coalesce(max(`row_number`), 0)
            from seat
            where classroom_id = #{classroomId}
            """)
    int selectMaxRowNumberByClassroomId(Long classroomId);

    @Select("""
            select coalesce(max(col_number), 0)
            from seat
            where classroom_id = #{classroomId}
            """)
    int selectMaxColNumberByClassroomId(Long classroomId);

    @Insert("""
            insert into seat (classroom_id, seat_number, `row_number`, col_number, status, remark)
            values (#{classroomId}, #{seatNumber}, #{rowNumber}, #{colNumber}, #{status}, #{remark})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Seat seat);

    @Delete("""
            delete from seat
            where id = #{id}
            """)
    int deleteById(Long id);


    @Delete("""
            delete from seat
            where classroom_id = #{classroomId}
            """)
    int batchDeleteByClassroomId(Long classroomId);

    @Update("update seat set status = #{status} , remark= #{remark} where id = #{id}")
    int updateById(Seat seat);

    @Update("""
            update seat
            set status = #{status},
                remark = case when #{remark} is null then remark else #{remark} end
            where classroom_id = #{classroomId}
            """)
    int batchUpdateByClassroomId(@Param("classroomId") Long classroomId,
                                 @Param("status") String status,
                                 @Param("remark") String remark);
}
